import { db } from "@workspace/db";
import { gamesTable, teamsTable, dataPullLogsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { logger } from "../logger";

const ODDS_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const ODDS_KEY = process.env.ODDS_API_KEY || "";

// Sports we ingest game odds for (must have an Odds API key + ESPN teams feed).
const SPORTS: Record<string, { oddsKey: string; espnPath: string }> = {
  MLB:  { oddsKey: "baseball_mlb",        espnPath: "baseball/mlb" },
  NFL:  { oddsKey: "americanfootball_nfl", espnPath: "football/nfl" },
  NBA:  { oddsKey: "basketball_nba",       espnPath: "basketball/nba" },
  WNBA: { oddsKey: "basketball_wnba",      espnPath: "basketball/wnba" },
  NHL:  { oddsKey: "icehockey_nhl",        espnPath: "hockey/nhl" },
};

/** Min ms between successful game-odds syncs — protects paid Odds API credits.
 *  Aligned with the 6-hour cron cadence. */
const MIN_INTERVAL_MS = 350 * 60 * 1000; // 350 minutes (just under 6 h)
/** Match an Odds API event to a games row within this window of commence time. */
const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000; // ±1 day

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function median(nums: number[]): number | null {
  const v = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Convert an American moneyline price to its raw implied probability (with vig).
 */
function americanToImplied(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * Remove the two-way vig from a pair of American moneyline prices and return
 * fair win probabilities. Returns null if either price is missing or invalid.
 */
function noVigWinProbs(homePrice: number, awayPrice: number): { home: number; away: number } | null {
  if (!Number.isFinite(homePrice) || !Number.isFinite(awayPrice)) return null;
  const rawHome = americanToImplied(homePrice);
  const rawAway = americanToImplied(awayPrice);
  const total = rawHome + rawAway;
  if (total <= 0) return null;
  return { home: rawHome / total, away: rawAway / total };
}

interface EspnTeam { abbreviation: string; displayName: string; shortDisplayName?: string; name?: string; location?: string }

/**
 * Build a full-name → our-DB-team-id map for a sport. ESPN's teams feed is the
 * same source the schedule sync uses, so abbreviations line up with games rows.
 * We index several name variants (displayName, location, nickname) so the Odds
 * API's full names resolve reliably.
 */
async function buildTeamResolver(sport: string, espnPath: string): Promise<Map<string, number>> {
  const resolver = new Map<string, number>();

  const dbTeams = await db
    .select({ id: teamsTable.id, abbreviation: teamsTable.abbreviation })
    .from(teamsTable)
    .where(eq(teamsTable.sport, sport));
  const idByAbbr = new Map<string, number>();
  for (const t of dbTeams) if (t.abbreviation) idByAbbr.set(t.abbreviation.toUpperCase(), t.id);

  let espnTeams: EspnTeam[] = [];
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (res.ok) {
      const data = await res.json() as any;
      espnTeams = (data?.sports?.[0]?.leagues?.[0]?.teams ?? [])
        .map((t: any) => t?.team)
        .filter(Boolean);
    }
  } catch (e) {
    logger.warn({ sport, err: e }, "game-odds: ESPN teams fetch failed");
  }

  for (const t of espnTeams) {
    const id = idByAbbr.get((t.abbreviation ?? "").toUpperCase());
    if (!id) continue;
    for (const variant of [t.displayName, t.shortDisplayName, t.name, t.location]) {
      if (variant) resolver.set(norm(variant), id);
    }
  }
  return resolver;
}

async function recentlySynced(): Promise<boolean> {
  const [last] = await db
    .select({ startedAt: dataPullLogsTable.startedAt })
    .from(dataPullLogsTable)
    .where(and(
      eq(dataPullLogsTable.jobName, "game-odds"),
      eq(dataPullLogsTable.status, "success"),
    ))
    .orderBy(desc(dataPullLogsTable.startedAt))
    .limit(1);
  return !!(last?.startedAt && Date.now() - last.startedAt.getTime() < MIN_INTERVAL_MS);
}

/**
 * Pull consensus point spread + total + moneyline for upcoming games and write
 * them onto the matching games rows (spread stored as the HOME spread: negative
 * = home favored). Also derives and stores:
 *   - impliedHomeTotal / impliedAwayTotal  (from spread + total arithmetic)
 *   - homeWinProb / awayWinProb            (no-vig moneyline probabilities)
 *
 * Uses the bulk /odds endpoint (markets=spreads,totals,h2h) — ~3 credits per
 * sport regardless of game count — and is credit-guarded by a 350-minute floor.
 */
export async function syncGameOdds(): Promise<number> {
  if (!ODDS_KEY) {
    logger.warn("ODDS_API_KEY not set — skipping game odds sync");
    return 0;
  }
  if (await recentlySynced()) {
    logger.info("game-odds: within min interval — skipping API calls");
    return 0;
  }

  let updated = 0;

  for (const [sport, { oddsKey, espnPath }] of Object.entries(SPORTS)) {
    try {
      const resolver = await buildTeamResolver(sport, espnPath);
      if (resolver.size === 0) {
        logger.info({ sport }, "game-odds: no resolvable teams — skipping sport");
        continue;
      }

      const res = await fetch(
        `${ODDS_BASE}/sports/${oddsKey}/odds?` +
        `apiKey=${ODDS_KEY}&regions=us,eu&markets=spreads,totals,h2h&oddsFormat=american&dateFormat=iso`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) {
        logger.warn({ sport, status: res.status }, "game-odds: odds fetch failed");
        continue;
      }
      const remaining = res.headers.get("x-requests-remaining");
      if (remaining !== null) logger.info({ sport, remaining }, "Odds API credits (game-odds)");

      const events = await res.json() as any[];
      for (const ev of events) {
        const homeId = resolver.get(norm(ev.home_team ?? ""));
        const awayId = resolver.get(norm(ev.away_team ?? ""));
        if (!homeId || !awayId) continue;

        // Consensus across books: home spread point, game total, and moneyline prices.
        const homeSpreads: number[] = [];
        const totals: number[] = [];
        const homeMoneylines: number[] = [];
        const awayMoneylines: number[] = [];

        for (const bk of (ev.bookmakers ?? [])) {
          for (const mkt of (bk.markets ?? [])) {
            if (mkt.key === "spreads") {
              const home = (mkt.outcomes ?? []).find(
                (o: any) => norm(o.name ?? "") === norm(ev.home_team ?? ""),
              );
              if (home?.point != null) homeSpreads.push(Number(home.point));
            } else if (mkt.key === "totals") {
              const over = (mkt.outcomes ?? []).find(
                (o: any) => (o.name ?? "").toLowerCase() === "over",
              );
              if (over?.point != null) totals.push(Number(over.point));
            } else if (mkt.key === "h2h") {
              const homeOutcome = (mkt.outcomes ?? []).find(
                (o: any) => norm(o.name ?? "") === norm(ev.home_team ?? ""),
              );
              const awayOutcome = (mkt.outcomes ?? []).find(
                (o: any) => norm(o.name ?? "") === norm(ev.away_team ?? ""),
              );
              if (homeOutcome?.price != null) homeMoneylines.push(Number(homeOutcome.price));
              if (awayOutcome?.price != null) awayMoneylines.push(Number(awayOutcome.price));
            }
          }
        }

        const spread = median(homeSpreads);
        const total = median(totals);
        const homeML = median(homeMoneylines);
        const awayML = median(awayMoneylines);

        if (spread == null && total == null) continue;

        // Derived: impliedHomeTotal = (total - spread) / 2
        // Home spread is negative when home is favored, so subtracting it
        // adds the margin to the home team's implied total correctly.
        let impliedHomeTotal: string | undefined;
        let impliedAwayTotal: string | undefined;
        if (spread != null && total != null) {
          impliedHomeTotal = ((total - spread) / 2).toFixed(2);
          impliedAwayTotal = ((total + spread) / 2).toFixed(2);
        }

        let homeWinProb: string | undefined;
        let awayWinProb: string | undefined;
        if (homeML != null && awayML != null) {
          const probs = noVigWinProbs(homeML, awayML);
          if (probs) {
            homeWinProb = probs.home.toFixed(6);
            awayWinProb = probs.away.toFixed(6);
          }
        }

        const commence = new Date(ev.commence_time);
        const lo = new Date(commence.getTime() - MATCH_WINDOW_MS);
        const hi = new Date(commence.getTime() + MATCH_WINDOW_MS);

        // Same teams can play more than once inside the ±1d window (double-headers,
        // back-to-backs). Pull all candidates and pick the one whose startTime is
        // nearest the odds commence_time so spreads/totals land on the right game.
        const candidates = await db
          .select({ id: gamesTable.id, startTime: gamesTable.startTime })
          .from(gamesTable)
          .where(and(
            eq(gamesTable.sport, sport),
            eq(gamesTable.homeTeamId, homeId),
            eq(gamesTable.awayTeamId, awayId),
            gte(gamesTable.startTime, lo),
            lte(gamesTable.startTime, hi),
          ));
        if (candidates.length === 0) continue;
        const game = candidates.reduce((best, c) =>
          Math.abs(new Date(c.startTime).getTime() - commence.getTime()) <
          Math.abs(new Date(best.startTime).getTime() - commence.getTime())
            ? c
            : best,
        );

        await db
          .update(gamesTable)
          .set({
            spread:           spread != null ? spread.toString() : undefined,
            total:            total != null ? total.toString() : undefined,
            impliedHomeTotal,
            impliedAwayTotal,
            homeWinProb,
            awayWinProb,
            updatedAt: new Date(),
          })
          .where(eq(gamesTable.id, game.id));
        updated++;
      }
    } catch (e) {
      logger.error({ sport, err: e }, "game-odds: sport sync error");
    }
  }

  logger.info({ updated }, "syncGameOdds complete");
  return updated;
}
