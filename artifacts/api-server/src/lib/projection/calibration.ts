/**
 * Probability calibration helpers.
 *
 * The raw normal-CDF P(over) is over-confident. The `probability_calibration`
 * table holds the EMPIRICAL hit rate per (sport, statType, lineType, edgeBucket,
 * direction) bucket, built from settled historical lines by the calibration job.
 * Here we blend a raw P(over) toward that empirical rate — bounded, conservative,
 * transparent, tunable (see PROBABILITY_CALIBRATION in priors.ts).
 *
 * Applied at BOTH probability sites (computeProjection's stored P(over) and
 * recalcPropScores' per-line P(over)) so display and scoring stay consistent.
 * The calibration job itself must use RAW P(over) (pass no map) so re-runs are
 * stable and never calibrate on already-calibrated values.
 */

import { db } from "@workspace/db";
import { probabilityCalibrationTable } from "@workspace/db/schema";
import { PROBABILITY_CALIBRATION } from "./priors";

/** Normalize sport label to its bucket family — MUST match between writer and consumers. */
export function normalizeSport(s: string): string {
  if (s.startsWith("NBA")) return "NBA";
  if (s.startsWith("MLB")) return "MLB";
  if (s.startsWith("NHL")) return "NHL";
  if (s.startsWith("NFL")) return "NFL";
  if (s.startsWith("WNBA")) return "WNBA";
  return s;
}

/** Edge bucket boundaries — MUST match between the job (writer) and consumers. */
export function getEdgeBucket(edgePct: number): string {
  if (edgePct < 5) return "0-5";
  if (edgePct < 10) return "5-10";
  if (edgePct < 15) return "10-15";
  if (edgePct < 20) return "15-20";
  if (edgePct < 25) return "20-25";
  return "25+";
}

export interface CalibrationCell {
  hitRate: number; // 0..1, empirical P(model's direction correct)
  sampleSize: number;
}

/** In-memory map keyed by `sport|statType|lineType|edgeBucket|direction`. */
export type CalibrationMap = Map<string, CalibrationCell>;

function key(
  sport: string,
  statType: string,
  lineType: string,
  edgeBucket: string,
  direction: string,
): string {
  return `${sport}|${statType}|${lineType}|${edgeBucket}|${direction}`;
}

/** Load the whole calibration table once into memory (cheap — a few hundred rows). */
export async function loadCalibrationMap(): Promise<CalibrationMap> {
  const rows = await db.select().from(probabilityCalibrationTable);
  const map: CalibrationMap = new Map();
  for (const r of rows) {
    if (r.hitRate == null) continue;
    map.set(
      key(r.sport, r.statType, r.lineType, r.edgeBucket, r.direction),
      { hitRate: Number(r.hitRate), sampleSize: Number(r.sampleSize ?? 0) },
    );
  }
  return map;
}

export interface CalibrationResult {
  pOver: number; // calibrated P(over), 0..100
  weightPct: number; // how much empirical rate was blended in, 0..100
  sampleSize: number; // settled results behind the bucket
  explain: string | null; // human-readable, null when no calibration applied
}

/**
 * Blend a raw P(over) toward the empirical bucket hit rate.
 * Returns the raw value unchanged when no qualifying bucket exists.
 */
export function calibratePOver(
  pOverRaw: number,
  sport: string,
  statType: string,
  lineType: string,
  map: CalibrationMap | null | undefined,
): CalibrationResult {
  const noop: CalibrationResult = {
    pOver: pOverRaw,
    weightPct: 0,
    sampleSize: 0,
    explain: null,
  };
  if (!map || map.size === 0) return noop;

  const direction = pOverRaw >= 50 ? "over" : "under";
  const edgeBucket = getEdgeBucket(Math.abs(pOverRaw - 50));
  const cell = map.get(key(normalizeSport(sport), statType, lineType, edgeBucket, direction));
  if (!cell || cell.sampleSize < PROBABILITY_CALIBRATION.minSampleSize) return noop;

  // empirical P(over): the table stores P(model direction correct)
  const empProbOver = direction === "over" ? cell.hitRate : 1 - cell.hitRate;
  const w = Math.min(
    PROBABILITY_CALIBRATION.maxBlendWeight,
    cell.sampleSize / (cell.sampleSize + PROBABILITY_CALIBRATION.weightK),
  );
  const calibrated = (1 - w) * (pOverRaw / 100) + w * empProbOver;
  const pOver = calibrated * 100;

  return {
    pOver,
    weightPct: Math.round(w * 100),
    sampleSize: cell.sampleSize,
    explain: `Calibrated ${pOverRaw.toFixed(0)}%→${pOver.toFixed(0)}% (bucket ${edgeBucket} ${direction}, ${cell.sampleSize} settled, ${(cell.hitRate * 100).toFixed(0)}% hit)`,
  };
}
