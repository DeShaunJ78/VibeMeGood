import { db } from "@workspace/db";
import { playerGameLogsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

export const ARENA_COORDS: Record<string, { lat: number; lon: number; tz: string; altitude: number }> = {
  "LAL": { lat: 34.0430, lon: -118.2673, tz: "America/Los_Angeles", altitude: 86 },
  "LAC": { lat: 34.0430, lon: -118.2673, tz: "America/Los_Angeles", altitude: 86 },
  "GSW": { lat: 37.7680, lon: -122.3877, tz: "America/Los_Angeles", altitude: 6 },
  "PHX": { lat: 33.4457, lon: -112.0712, tz: "America/Phoenix", altitude: 1082 },
  "SAC": { lat: 38.5805, lon: -121.4991, tz: "America/Los_Angeles", altitude: 9 },
  "POR": { lat: 45.5316, lon: -122.6668, tz: "America/Los_Angeles", altitude: 12 },
  "OKC": { lat: 35.4634, lon: -97.5151, tz: "America/Chicago", altitude: 366 },
  "DEN": { lat: 39.7487, lon: -105.0077, tz: "America/Denver", altitude: 1609 },
  "UTA": { lat: 40.7683, lon: -111.9011, tz: "America/Denver", altitude: 1288 },
  "MIN": { lat: 44.9795, lon: -93.2760, tz: "America/Chicago", altitude: 260 },
  "DAL": { lat: 32.7905, lon: -96.8103, tz: "America/Chicago", altitude: 183 },
  "HOU": { lat: 29.7508, lon: -95.3621, tz: "America/Chicago", altitude: 12 },
  "MEM": { lat: 35.1381, lon: -90.0505, tz: "America/Chicago", altitude: 84 },
  "NOP": { lat: 29.9490, lon: -90.0820, tz: "America/Chicago", altitude: 1 },
  "SAS": { lat: 29.4270, lon: -98.4375, tz: "America/Chicago", altitude: 198 },
  "CHI": { lat: 41.8807, lon: -87.6742, tz: "America/Chicago", altitude: 180 },
  "IND": { lat: 39.7639, lon: -86.1555, tz: "America/Indiana/Indianapolis", altitude: 220 },
  "MIL": { lat: 43.0450, lon: -87.9170, tz: "America/Chicago", altitude: 193 },
  "CLE": { lat: 41.4965, lon: -81.6882, tz: "America/New_York", altitude: 199 },
  "DET": { lat: 42.3410, lon: -83.0550, tz: "America/Detroit", altitude: 183 },
  "TOR": { lat: 43.6435, lon: -79.3791, tz: "America/Toronto", altitude: 76 },
  "BOS": { lat: 42.3662, lon: -71.0621, tz: "America/New_York", altitude: 8 },
  "NYK": { lat: 40.7505, lon: -73.9934, tz: "America/New_York", altitude: 10 },
  "BKN": { lat: 40.6827, lon: -73.9754, tz: "America/New_York", altitude: 10 },
  "PHI": { lat: 39.9012, lon: -75.1720, tz: "America/New_York", altitude: 9 },
  "WAS": { lat: 38.8981, lon: -77.0209, tz: "America/New_York", altitude: 6 },
  "ATL": { lat: 33.7573, lon: -84.3963, tz: "America/New_York", altitude: 306 },
  "CHA": { lat: 35.2251, lon: -80.8392, tz: "America/New_York", altitude: 229 },
  "ORL": { lat: 28.5392, lon: -81.3839, tz: "America/New_York", altitude: 30 },
  "MIA": { lat: 25.7814, lon: -80.1870, tz: "America/New_York", altitude: 4 },
};

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeFatigueScore(data: {
  daysRest: number;
  isBackToBack: boolean;
  isThreeInFour: boolean;
  travelMiles: number;
  timezoneShiftHours: number;
  prevGameMinutes: number;
  prevGameWasOT: boolean;
  isEarlyGame: boolean;
}): { score: number; label: string; warnings: string[] } {
  let score = 0;
  const warnings: string[] = [];

  if (data.isBackToBack) {
    score += 35;
    warnings.push("back_to_back");
  } else if (data.daysRest === 2) {
    score += 10;
  } else if (data.daysRest >= 4) {
    score -= 10;
  }

  if (data.isThreeInFour) {
    score += 20;
    warnings.push("three_in_four");
  }

  if (data.travelMiles > 2000) score += 15;
  else if (data.travelMiles > 1000) score += 8;
  else if (data.travelMiles > 500) score += 4;

  if (Math.abs(data.timezoneShiftHours) >= 3) score += 10;
  else if (Math.abs(data.timezoneShiftHours) >= 2) score += 5;

  if (data.prevGameMinutes >= 40) score += 10;
  else if (data.prevGameMinutes >= 36) score += 5;

  if (data.prevGameWasOT) score += 8;
  if (data.isEarlyGame) score += 5;

  score = Math.max(0, Math.min(100, score));

  const label = score >= 60 ? "Heavy fatigue load"
    : score >= 40 ? "Moderate fatigue"
    : score >= 20 ? "Mild fatigue"
    : score <= -5 ? "Well rested — advantage"
    : "Normal rest";

  return { score, label, warnings };
}

export function computeBlowoutRisk(spread: number, total: number, sport: string): {
  probability: number;
  warning: string | null;
  evAdjustment: number;
} {
  const absSpread = Math.abs(spread);
  const thresholds: Record<string, { moderate: number; heavy: number; extreme: number }> = {
    NBA: { moderate: 9, heavy: 14, extreme: 18 },
    NFL: { moderate: 10, heavy: 14, extreme: 17 },
    MLB: { moderate: 2.5, heavy: 3.5, extreme: 5 },
    NHL: { moderate: 1.5, heavy: 2, extreme: 2.5 },
  };
  const t = thresholds[sport] ?? thresholds.NBA;

  let probability = 0;
  let evAdjustment = 0;
  let warning: string | null = null;

  if (absSpread >= t.extreme) {
    probability = 65;
    evAdjustment = -0.10;
    warning = "blowout_risk_extreme";
  } else if (absSpread >= t.heavy) {
    probability = 45;
    evAdjustment = -0.06;
    warning = "blowout_sensitive";
  } else if (absSpread >= t.moderate) {
    probability = 25;
    evAdjustment = -0.02;
    warning = null;
  }

  // total not used in base formula but available for future extensions
  void total;

  return { probability, warning, evAdjustment };
}

export async function computeUsageDelta(
  playerId: number,
  _statType: string,
): Promise<{ score: number; usageDelta: number; minutesTrend: "up" | "stable" | "down"; label: string }> {
  const allLogs = await db.select({
    minutes: playerGameLogsTable.minutes,
    gameDate: playerGameLogsTable.gameDate,
  }).from(playerGameLogsTable)
    .where(eq(playerGameLogsTable.playerId, playerId))
    .orderBy(desc(playerGameLogsTable.gameDate))
    .limit(40);

  // Deduplicate by gameDate, take first entry per date
  const seen = new Set<string>();
  const uniqueLogs = allLogs.filter(l => {
    if (seen.has(l.gameDate)) return false;
    seen.add(l.gameDate);
    return true;
  }).slice(0, 20);

  const logsWithMinutes = uniqueLogs.filter(l => l.minutes !== null);
  if (logsWithMinutes.length < 5) {
    return { score: 50, usageDelta: 0, minutesTrend: "stable", label: "Insufficient data" };
  }

  const recent5 = logsWithMinutes.slice(0, 5).map(l => parseFloat(l.minutes!.toString()));
  const season = logsWithMinutes.map(l => parseFloat(l.minutes!.toString()));

  const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
  const seasonAvg = season.reduce((a, b) => a + b, 0) / season.length;
  const delta = seasonAvg > 0 ? ((recentAvg - seasonAvg) / seasonAvg) * 100 : 0;

  let score = 50;
  let minutesTrend: "up" | "stable" | "down" = "stable";

  if (delta > 15) { score = 90; minutesTrend = "up"; }
  else if (delta > 8) { score = 72; minutesTrend = "up"; }
  else if (delta > 3) { score = 60; minutesTrend = "up"; }
  else if (delta < -15) { score = 15; minutesTrend = "down"; }
  else if (delta < -8) { score = 28; minutesTrend = "down"; }
  else if (delta < -3) { score = 40; minutesTrend = "down"; }

  const label = delta > 8 ? `+${delta.toFixed(0)}% usage spike — expanded role`
    : delta < -8 ? `${delta.toFixed(0)}% usage drop — reduced role`
    : "Usage stable";

  return { score, usageDelta: delta, minutesTrend, label };
}

export function computeEVModifier(signals: {
  fatigueScore: number;
  blowoutAdjustment: number;
  usageDelta: number;
  aggressiveMode: boolean;
}): number {
  let modifier = 0;

  if (signals.fatigueScore >= 60) {
    modifier -= 0.06;
  } else if (signals.fatigueScore >= 40) {
    modifier -= 0.03;
  } else if (signals.fatigueScore <= -5) {
    modifier += 0.02;
  }

  modifier += signals.blowoutAdjustment;

  if (signals.usageDelta > 15) modifier += 0.06;
  else if (signals.usageDelta > 8) modifier += 0.03;
  else if (signals.usageDelta < -15) modifier -= 0.05;
  else if (signals.usageDelta < -8) modifier -= 0.02;

  if (signals.aggressiveMode) modifier *= 2;

  return Math.max(-0.15, Math.min(0.15, modifier));
}
