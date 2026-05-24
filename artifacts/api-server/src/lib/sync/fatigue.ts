import { db } from "@workspace/db";
import {
  fatigueDataTable, playerGameLogsTable, ppLinesTable,
  playersTable, teamsTable,
} from "@workspace/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { logger } from "../logger";

const ARENA_COORDS: Record<string, { lat: number; lon: number; tz: string }> = {
  LAL: { lat: 34.0430, lon: -118.2673, tz: "America/Los_Angeles" },
  LAC: { lat: 34.0430, lon: -118.2673, tz: "America/Los_Angeles" },
  GSW: { lat: 37.7680, lon: -122.3877, tz: "America/Los_Angeles" },
  PHX: { lat: 33.4457, lon: -112.0712, tz: "America/Phoenix"     },
  SAC: { lat: 38.5805, lon: -121.4991, tz: "America/Los_Angeles" },
  POR: { lat: 45.5316, lon: -122.6668, tz: "America/Los_Angeles" },
  OKC: { lat: 35.4634, lon: -97.5151,  tz: "America/Chicago"     },
  DEN: { lat: 39.7487, lon: -105.0077, tz: "America/Denver"      },
  UTA: { lat: 40.7683, lon: -111.9011, tz: "America/Denver"      },
  MIN: { lat: 44.9795, lon: -93.2760,  tz: "America/Chicago"     },
  DAL: { lat: 32.7905, lon: -96.8103,  tz: "America/Chicago"     },
  HOU: { lat: 29.7508, lon: -95.3621,  tz: "America/Chicago"     },
  MEM: { lat: 35.1381, lon: -90.0505,  tz: "America/Chicago"     },
  NOP: { lat: 29.9490, lon: -90.0820,  tz: "America/Chicago"     },
  SAS: { lat: 29.4270, lon: -98.4375,  tz: "America/Chicago"     },
  CHI: { lat: 41.8807, lon: -87.6742,  tz: "America/Chicago"     },
  IND: { lat: 39.7639, lon: -86.1555,  tz: "America/Indiana/Indianapolis" },
  MIL: { lat: 43.0450, lon: -87.9170,  tz: "America/Chicago"     },
  CLE: { lat: 41.4965, lon: -81.6882,  tz: "America/New_York"    },
  DET: { lat: 42.3410, lon: -83.0550,  tz: "America/Detroit"     },
  TOR: { lat: 43.6435, lon: -79.3791,  tz: "America/Toronto"     },
  BOS: { lat: 42.3662, lon: -71.0621,  tz: "America/New_York"    },
  NYK: { lat: 40.7505, lon: -73.9934,  tz: "America/New_York"    },
  BKN: { lat: 40.6827, lon: -73.9754,  tz: "America/New_York"    },
  PHI: { lat: 39.9012, lon: -75.1720,  tz: "America/New_York"    },
  WAS: { lat: 38.8981, lon: -77.0209,  tz: "America/New_York"    },
  ATL: { lat: 33.7573, lon: -84.3963,  tz: "America/New_York"    },
  CHA: { lat: 35.2251, lon: -80.8392,  tz: "America/New_York"    },
  ORL: { lat: 28.5392, lon: -81.3839,  tz: "America/New_York"    },
  MIA: { lat: 25.7814, lon: -80.1870,  tz: "America/New_York"    },
  LVA: { lat: 36.0905, lon: -115.1771, tz: "America/Los_Angeles" },
  SEA: { lat: 47.6062, lon: -122.3321, tz: "America/Los_Angeles" },
};

function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function timezoneOffsetHours(tz1: string, tz2: string): number {
  const offsets: Record<string, number> = {
    "America/Los_Angeles": -8, "America/Phoenix": -7, "America/Denver": -7,
    "America/Chicago": -6, "America/Indiana/Indianapolis": -5,
    "America/New_York": -5, "America/Detroit": -5, "America/Toronto": -5,
  };
  return Math.abs((offsets[tz1] ?? -5) - (offsets[tz2] ?? -5));
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.round(Math.abs(b - a) / (1000 * 60 * 60 * 24));
}

function computeFatigueScore(data: {
  daysRest: number;
  isBackToBack: boolean;
  isThreeInFour: boolean;
  gamesLast7: number;
  prevGameMinutes: number;
  travelMiles: number;
  timezoneShift: number;
}): { score: number; label: string; warnings: string[] } {
  let score = 0;
  const warnings: string[] = [];

  if (data.isBackToBack) {
    score += 35;
    warnings.push("back_to_back");
  } else if (data.daysRest === 2) {
    score += 8;
  } else if (data.daysRest >= 4) {
    score -= 10;
  }

  if (data.isThreeInFour) {
    score += 20;
    warnings.push("three_in_four");
  }

  if (data.gamesLast7 >= 5) { score += 10; warnings.push("heavy_schedule"); }
  else if (data.gamesLast7 === 4) score += 5;

  if (data.prevGameMinutes >= 40) { score += 10; warnings.push("heavy_minutes"); }
  else if (data.prevGameMinutes >= 36) score += 5;

  if (data.travelMiles > 2000) { score += 15; warnings.push("long_travel"); }
  else if (data.travelMiles > 1000) score += 8;
  else if (data.travelMiles > 500) score += 4;

  if (data.timezoneShift >= 3) { score += 10; warnings.push("timezone_shift"); }
  else if (data.timezoneShift >= 2) score += 5;

  score = Math.max(-10, Math.min(100, score));

  const label =
    score >= 70 ? "Heavy fatigue" :
    score >= 50 ? "Elevated fatigue" :
    score >= 30 ? "Mild fatigue" :
    score <= -5 ? "Well rested — advantage" :
    "Normal rest";

  return { score, label, warnings };
}

export async function syncFatigueData(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0];

  const activePlayers = await db
    .select({ playerId: ppLinesTable.playerId, sport: playersTable.sport })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  const uniquePlayers = [
    ...new Map(activePlayers.map(p => [p.playerId, p])).values(),
  ].filter(p => p.playerId !== null);

  let computed = 0;

  for (const { playerId, sport } of uniquePlayers) {
    try {
      if (!["NBA", "WNBA", "NHL", "MLB", "NFL"].includes(sport ?? "")) {
        continue;
      }

      const statType = sport === "MLB" ? "Hits" : "Points";

      const logs = await db
        .select()
        .from(playerGameLogsTable)
        .where(
          and(
            eq(playerGameLogsTable.playerId, playerId!),
            gte(playerGameLogsTable.gameDate, sevenDaysAgo),
            eq(playerGameLogsTable.statType, statType),
          )
        )
        .orderBy(desc(playerGameLogsTable.gameDate))
        .limit(10);

      if (!logs.length) {
        await db.insert(fatigueDataTable).values({
          playerId:        playerId!,
          computedForDate: today,
          daysRest:        null,
          isBackToBack:    false,
          isThreeInFour:   false,
          gamesLast7Days:  0,
          fatigueScore:    0,
          fatigueLabel:    "No recent games",
          warnings:        "",
          computedAt:      new Date(),
        }).onConflictDoUpdate({
          target: [fatigueDataTable.playerId, fatigueDataTable.computedForDate],
          set: { fatigueScore: 0, fatigueLabel: "No recent games", computedAt: new Date() },
        });
        continue;
      }

      const mostRecentLog = logs[0];
      const lastGameDate  = mostRecentLog.gameDate;
      const daysRest      = daysBetween(lastGameDate, today);
      const isBackToBack  = daysRest <= 1;

      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
        .toISOString().split("T")[0];
      const recentLogs    = logs.filter(l => l.gameDate >= fourDaysAgo);
      const isThreeInFour = recentLogs.length >= 3;

      const prevGameMinutes = parseFloat(mostRecentLog.minutes?.toString() ?? "0");

      const minutesL5 = logs.slice(0, 5)
        .map(l => parseFloat(l.minutes?.toString() ?? "0"))
        .filter(m => m > 0);
      const avgMinutesL5 = minutesL5.length
        ? minutesL5.reduce((a, b) => a + b, 0) / minutesL5.length
        : 0;

      let travelMiles = 0;
      let timezoneShift = 0;

      const prevHomeAway = mostRecentLog.homeAway;

      const playerTeam = await db
        .select({ abbreviation: teamsTable.abbreviation })
        .from(teamsTable)
        .innerJoin(playersTable, eq(playersTable.teamId, teamsTable.id))
        .where(eq(playersTable.id, playerId!))
        .limit(1);

      const teamAbbr   = playerTeam[0]?.abbreviation?.toUpperCase() ?? "";
      const homeCoords = ARENA_COORDS[teamAbbr];

      if (homeCoords && prevHomeAway === "away" && mostRecentLog.opponentTeamId) {
        const oppTeam = await db
          .select({ abbreviation: teamsTable.abbreviation })
          .from(teamsTable)
          .where(eq(teamsTable.id, mostRecentLog.opponentTeamId))
          .limit(1);
        const oppAbbr   = oppTeam[0]?.abbreviation?.toUpperCase() ?? "";
        const oppCoords = ARENA_COORDS[oppAbbr];

        if (oppCoords) {
          travelMiles   = Math.round(haversineDistanceMiles(oppCoords.lat, oppCoords.lon, homeCoords.lat, homeCoords.lon));
          timezoneShift = timezoneOffsetHours(oppCoords.tz, homeCoords.tz);
        }
      }

      const { score, label, warnings } = computeFatigueScore({
        daysRest,
        isBackToBack,
        isThreeInFour,
        gamesLast7:     logs.length,
        prevGameMinutes,
        travelMiles,
        timezoneShift,
      });

      await db.insert(fatigueDataTable).values({
        playerId:            playerId!,
        computedForDate:     today,
        lastGameDate,
        daysRest,
        isBackToBack,
        isThreeInFour,
        gamesLast7Days:      logs.length,
        prevGameMinutes:     prevGameMinutes.toString(),
        avgMinutesL5:        avgMinutesL5.toFixed(1),
        prevGameHomeAway:    prevHomeAway ?? null,
        travelMiles,
        timezoneShiftHours:  timezoneShift,
        fatigueScore:        score,
        fatigueLabel:        label,
        warnings:            warnings.join(","),
        computedAt:          new Date(),
      }).onConflictDoUpdate({
        target: [fatigueDataTable.playerId, fatigueDataTable.computedForDate],
        set: {
          daysRest, isBackToBack, isThreeInFour,
          gamesLast7Days:     logs.length,
          prevGameMinutes:    prevGameMinutes.toString(),
          avgMinutesL5:       avgMinutesL5.toFixed(1),
          travelMiles,
          timezoneShiftHours: timezoneShift,
          fatigueScore:       score,
          fatigueLabel:       label,
          warnings:           warnings.join(","),
          computedAt:         new Date(),
        },
      });

      computed++;
    } catch (err) {
      logger.error({ err, playerId }, "Fatigue compute error");
    }
  }

  logger.info({ computed }, "Fatigue data synced");
  return computed;
}
