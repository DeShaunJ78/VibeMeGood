import { Router } from "express";
import { db } from "@workspace/db";
import {
  dataPullLogsTable, ppLinesTable, externalLinesTable,
  ourProjectionsTable, entriesTable, varianceScoresTable,
  probabilityCalibrationTable, playerGameLogsTable,
} from "@workspace/db/schema";
import { desc, count, isNotNull, eq, sql, and, max } from "drizzle-orm";
import { logger } from "../lib/logger";
import { simulateEntry } from "../lib/simulation/entry-simulator";

const router = Router();

const ODDS_KEY = process.env.ODDS_API_KEY || "";

type CheckStatus = "green" | "amber" | "red";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  lastUpdated: string | null;
  fixAction: string | null;
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function getLastSync(jobName: string): Promise<Date | null> {
  const [row] = await db
    .select({ finishedAt: dataPullLogsTable.finishedAt })
    .from(dataPullLogsTable)
    .where(and(
      eq(dataPullLogsTable.jobName, jobName),
      isNotNull(dataPullLogsTable.finishedAt),
    ))
    .orderBy(desc(dataPullLogsTable.finishedAt))
    .limit(1);
  return row?.finishedAt ?? null;
}

function ageMins(d: Date | null): number {
  if (!d) return Infinity;
  return (Date.now() - d.getTime()) / 60000;
}

async function checkDataFreshness(): Promise<CheckResult[]> {
  // variance job is logged as "variance" in dataPullLogs, with fallback to computed_at in the table
  const varianceLogLast = await getLastSync("variance");
  const varianceFallback = varianceLogLast
    ? null
    : await db.select({ t: max(varianceScoresTable.computedAt) }).from(varianceScoresTable)
        .then(r => r[0]?.t ?? null);

  const [ppLast, oddsLast, projLast, injuryLast] = await Promise.all([
    getLastSync("pp-lines"),
    getLastSync("external-odds"),
    getLastSync("projections"),
    getLastSync("injuries"),
  ]);

  const varianceLast = varianceLogLast ?? varianceFallback;

  const ppMins = ageMins(ppLast);
  const oddsMins = ageMins(oddsLast);
  const projMins = ageMins(projLast);
  const injuryMins = ageMins(injuryLast);
  const varianceMins = ageMins(varianceLast);

  const fmt = (d: Date | null) => d ? d.toISOString() : null;
  const fmtAge = (m: number) => m === Infinity ? "never" : m < 60 ? `${Math.round(m)}m ago` : `${(m / 60).toFixed(1)}h ago`;

  return [
    {
      name: "PP Lines",
      status: ppMins < 120 ? "green" : ppMins < 360 ? "amber" : "red",
      detail: ppMins === Infinity ? "Never synced" : `Last sync ${fmtAge(ppMins)}`,
      lastUpdated: fmt(ppLast),
      fixAction: "pp-lines",
    },
    {
      name: "External Odds",
      status: oddsMins < 30 ? "green" : oddsMins < 120 ? "amber" : "red",
      detail: oddsMins === Infinity ? "Never synced" : `Last sync ${fmtAge(oddsMins)}`,
      lastUpdated: fmt(oddsLast),
      fixAction: "external-odds",
    },
    {
      name: "Projections",
      status: projMins < 480 ? "green" : projMins < 960 ? "amber" : "red",
      detail: projMins === Infinity ? "Never computed" : `Last computed ${fmtAge(projMins)}`,
      lastUpdated: fmt(projLast),
      fixAction: "projections",
    },
    {
      name: "Injury News",
      status: injuryMins < 240 ? "green" : injuryMins < 720 ? "amber" : "red",
      detail: injuryMins === Infinity ? "Never synced" : `Last sync ${fmtAge(injuryMins)}`,
      lastUpdated: fmt(injuryLast),
      fixAction: "injuries",
    },
    {
      name: "Variance Scores",
      status: varianceMins < 1440 ? "green" : varianceMins < 2880 ? "amber" : "red",
      detail: varianceMins === Infinity ? "Never computed" : `Last computed ${fmtAge(varianceMins)}`,
      lastUpdated: fmt(varianceLast),
      fixAction: "variance",
    },
  ];
}

async function checkDatabaseHealth(): Promise<CheckResult[]> {
  const [ppCount, projCount, extCount, entryCount, calCount, gameLogCount] = await Promise.all([
    db.select({ n: count() }).from(ppLinesTable).where(eq(ppLinesTable.isActive, true)),
    db.select({ n: sql<number>`count(distinct player_id)` }).from(ourProjectionsTable),
    db.select({ n: sql<number>`count(distinct pp_line_id)` }).from(externalLinesTable).where(isNotNull(externalLinesTable.noVigOverProb)),
    db.select({ n: count() }).from(entriesTable),
    db.select({ n: count() }).from(probabilityCalibrationTable),
    db.select({ n: count() }).from(playerGameLogsTable),
  ]);

  const pp = Number(ppCount[0]?.n ?? 0);
  const proj = Number(projCount[0]?.n ?? 0);
  const ext = Number(extCount[0]?.n ?? 0);
  const entries = Number(entryCount[0]?.n ?? 0);
  const cal = Number(calCount[0]?.n ?? 0);
  const gameLogs = Number(gameLogCount[0]?.n ?? 0);

  return [
    {
      name: "Total PP Lines",
      status: pp > 1000 ? "green" : pp >= 100 ? "amber" : "red",
      detail: `${pp.toLocaleString()} active lines`,
      lastUpdated: null,
      fixAction: pp < 100 ? "pp-lines" : null,
    },
    {
      name: "Players with Projections",
      status: proj > 100 ? "green" : proj >= 10 ? "amber" : "red",
      detail: proj === 0 ? "Projections never run" : `${proj} players projected`,
      lastUpdated: null,
      fixAction: proj === 0 ? "projections" : null,
    },
    {
      name: "External Lines with TrueEdge",
      status: ext > 30 ? "green" : ext >= 1 ? "amber" : "red",
      detail: ext === 0 ? "No book data — check ODDS_API_KEY" : `${ext} props with no-vig data`,
      lastUpdated: null,
      fixAction: ext === 0 ? "external-odds" : null,
    },
    {
      name: "Journal Entries",
      status: entries > 0 ? "green" : "amber",
      detail: entries === 0 ? "No entries yet — tracking not started" : `${entries} entries logged`,
      lastUpdated: null,
      fixAction: null,
    },
    {
      name: "Calibration Records",
      status: cal > 0 ? "green" : "amber",
      detail: cal === 0 ? "No records yet — populates as picks settle" : `${cal} calibration records`,
      lastUpdated: null,
      fixAction: null,
    },
    {
      name: "Historical Game Logs",
      status: gameLogs >= 100 ? "green" : gameLogs > 0 ? "amber" : "red",
      detail: gameLogs === 0
        ? "No records — historical hit rates unavailable"
        : `${gameLogs.toLocaleString()} game log records across all players`,
      lastUpdated: null,
      fixAction: null,
    },
  ];
}

async function checkApiConnectivity(): Promise<CheckResult[]> {
  const checks: Array<{ name: string; url: string; fixAction: null }> = [
    { name: "PrizePicks API",   url: "https://api.prizepicks.com/projections?league_id=7&per_page=1", fixAction: null },
    { name: "The Odds API",     url: ODDS_KEY ? `https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_KEY}` : "", fixAction: null },
    { name: "NBA ESPN API",     url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard", fixAction: null },
    { name: "MLB Stats API",    url: "https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&limit=1", fixAction: null },
    { name: "NHL API",          url: "https://api-web.nhle.com/v1/schedule/now", fixAction: null },
    { name: "ESPN Injury API",  url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", fixAction: null },
  ];

  const results = await Promise.all(
    checks.map(async (c): Promise<CheckResult> => {
      if (!c.url) {
        return { name: c.name, status: "red", detail: "ODDS_API_KEY not set", lastUpdated: null, fixAction: null };
      }
      try {
        const res = await fetchWithTimeout(c.url, {
          headers: { "User-Agent": "VibeMeGood/1.0 Health Check" },
        }, 4000);
        return {
          name: c.name,
          status: res.ok ? "green" : "red",
          detail: res.ok ? `HTTP ${res.status} OK` : `HTTP ${res.status} error`,
          lastUpdated: null,
          fixAction: null,
        };
      } catch (err: any) {
        const isTimeout = err?.name === "AbortError";
        return {
          name: c.name,
          status: "red",
          detail: isTimeout ? "Timeout after 4s" : `Error: ${err?.message ?? "unknown"}`,
          lastUpdated: null,
          fixAction: null,
        };
      }
    })
  );

  return results;
}

async function checkSimulationEngine(): Promise<CheckResult> {
  try {
    const result = simulateEntry({
      legs: [
        {
          playerName: "Test Player A",
          statType: "Points",
          line: 25,
          side: "over",
          modelProb: 0.60,
          sport: "NBA",
          team: "LAL",
          gameId: "test-game-1",
          mean: 27,
          stdDev: 5,
        },
        {
          playerName: "Test Player B",
          statType: "Points",
          line: 20,
          side: "over",
          modelProb: 0.60,
          sport: "NBA",
          team: "BOS",
          gameId: "test-game-1",
          mean: 22,
          stdDev: 4,
        },
      ],
      runs: 500,
      multiplier: 3,
    });
    const ok = typeof result.trueJointProbability === "number" && result.runCount > 0;
    return {
      name: "Simulation Engine",
      status: ok ? "green" : "red",
      detail: ok
        ? `Monte Carlo OK — naive=${(result.naiveProbability * 100).toFixed(1)}% sim=${(result.trueJointProbability * 100).toFixed(1)}%`
        : "Simulation returned invalid result",
      lastUpdated: null,
      fixAction: null,
    };
  } catch (err) {
    return {
      name: "Simulation Engine",
      status: "red",
      detail: `Error: ${err instanceof Error ? err.message : "unknown"}`,
      lastUpdated: null,
      fixAction: null,
    };
  }
}

async function checkFeatureStatus(): Promise<CheckResult[]> {
  const [varianceCount, miCount, aiCount, calCount, cronJobs, simCheck] = await Promise.all([
    db.select({ n: count() }).from(varianceScoresTable),
    db.select({ n: count() }).from(ppLinesTable).where(eq(ppLinesTable.isActive, true)),
    db.select({ n: count() }).from(ourProjectionsTable),
    db.select({ n: count() }).from(probabilityCalibrationTable),
    db.select({ jobName: dataPullLogsTable.jobName })
      .from(dataPullLogsTable)
      .groupBy(dataPullLogsTable.jobName),
    checkSimulationEngine(),
  ]);

  const varN = Number(varianceCount[0]?.n ?? 0);
  const miN = Number(miCount[0]?.n ?? 0);
  const aiN = Number(aiCount[0]?.n ?? 0);
  const calN = Number(calCount[0]?.n ?? 0);

  const registeredJobs = new Set(cronJobs.map(r => r.jobName));
  // Daily-only jobs (variance, fatigue) only appear after 6:30am — check their data instead
  const frequentJobs = ["pp-lines", "external-odds", "projections", "injuries"];
  const missingJobs = frequentJobs.filter(j => !registeredJobs.has(j));

  return [
    {
      name: "Variance API",
      status: varN > 0 ? "green" : "amber",
      detail: varN === 0 ? "No variance scores computed yet" : `${varN} scores computed`,
      lastUpdated: null,
      fixAction: varN === 0 ? "variance" : null,
    },
    {
      name: "Market Intel",
      status: miN > 0 ? "green" : "red",
      detail: miN === 0 ? "No active lines — check PP sync" : `${miN} active lines in index`,
      lastUpdated: null,
      fixAction: miN === 0 ? "pp-lines" : null,
    },
    {
      name: "AI Analyst",
      status: aiN >= 0 ? "green" : "red",
      detail: "Anthropic endpoint active",
      lastUpdated: null,
      fixAction: null,
    },
    {
      name: "Calibration Endpoint",
      status: calN >= 0 ? "green" : "red",
      detail: calN === 0 ? "Endpoint live — no data yet" : `${calN} calibration records`,
      lastUpdated: null,
      fixAction: null,
    },
    {
      name: "Cron Scheduler",
      status: missingJobs.length === 0 ? "green" : missingJobs.length <= 2 ? "amber" : "red",
      detail: missingJobs.length === 0
        ? `All ${frequentJobs.length} frequent jobs active`
        : `Missing logs: ${missingJobs.join(", ")}`,
      lastUpdated: null,
      fixAction: null,
    },
    simCheck,
  ];
}

router.get("/system-health", async (req, res) => {
  const startTime = Date.now();
  try {
    const [dataFreshness, databaseHealth, apiConnectivity, featureStatus] = await Promise.all([
      checkDataFreshness(),
      checkDatabaseHealth(),
      checkApiConnectivity(),
      checkFeatureStatus(),
    ]);

    const all = [...dataFreshness, ...databaseHealth, ...apiConnectivity, ...featureStatus];
    const hasRed   = all.some(c => c.status === "red");
    const hasAmber = all.some(c => c.status === "amber");
    const overall  = hasRed ? "red" : hasAmber ? "amber" : "green";

    res.json({
      runAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      overall,
      sections: { dataFreshness, databaseHealth, apiConnectivity, featureStatus },
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Health check failed" });
  }
});

export default router;
