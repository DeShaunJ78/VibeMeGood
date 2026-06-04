/**
 * Population-level priors for PrizePicks-eligible players (higher-usage starters/stars).
 * Used for Bayesian shrinkage when sample sizes are small.
 *
 * ALL values are PER-GAME rates for a PP-eligible starter/regular contributor.
 * DB all-player means are multiplied by a "starter uplift" factor (~1.2–1.8×)
 * to reflect that PrizePicks targets above-average performers.
 *
 * Keys MUST match the exact canonical stat_type strings in player_game_logs.
 * getPrior() tries exact match first, then lowercased, then DEFAULT_PRIOR.
 *
 * DO NOT use abbreviated/abbreviated keys like "RBI" if the DB uses "RBIs",
 * or "passing yards" if the DB uses "Pass Yards" — key mismatches silently
 * fall through to DEFAULT_PRIOR = { mean: 2.5, std: 3.0 }, which will badly
 * inflate or deflate pOver via Bayesian shrinkage.
 *
 * Anchoring methodology:
 *   DB all-player mean/std from actual player_game_logs (42 sport×stat rows).
 *   PP-eligible mean ≈ DB mean × starter-uplift (varies by stat concentration).
 *   std kept close to DB std (variance doesn't scale as strongly with skill level).
 */

export interface Prior {
  mean: number;
  std: number;
}

/** Minimum games for a PLAY-eligible projection */
export const MIN_GAMES_FOR_PLAY = 5;

/** Shrinkage strength — equivalent to this many "prior games" */
export const SHRINKAGE_K = 8;

/** Data quality threshold below which we force NO-PLAY */
export const DQ_PLAY_THRESHOLD = 25;

/** Projection TTL — staleness gate in hours */
export const PROJECTION_TTL_HOURS = 6;

/**
 * Probability calibration (Addition 9, reworked).
 *
 * The raw normal-CDF P(over) from (mean, std) is over-confident — its tails are
 * too thin because player stats aren't perfectly normal and small samples
 * underestimate true variance. The `probability_calibration` table records the
 * EMPIRICAL hit rate for each (sport, statType, lineType, edgeBucket, direction)
 * bucket from settled historical lines. We blend the raw probability toward that
 * empirical rate — bounded, conservative, transparent, tunable.
 */
export const PROBABILITY_CALIBRATION = {
  /** Don't calibrate unless the matching bucket has at least this many settled results. */
  minSampleSize: 40,
  /** Hard cap on how much the empirical rate can override the model (keeps it conservative). */
  maxBlendWeight: 0.5,
  /** Shrinkage constant: blend weight = min(maxBlendWeight, sampleSize / (sampleSize + K)). */
  weightK: 200,
} as const;

export const LINE_TYPE_STD_ADJ: Record<string, number> = {
  goblin: 1.05,
  demon:  1.05,
  standard: 1.0,
};

/** Sport × stat population priors.
 *  Keys are EXACT canonical stat_type strings from player_game_logs. */
const PRIORS: Record<string, Record<string, Prior>> = {

  // ── NBA ──────────────────────────────────────────────────────────────────
  // DB all-player means (5.5k rows): Points 16.8, Reb 5.3, Ast 3.7,
  // Blocked Shots 0.62, Steals 1.0, TO 1.76, 3-PT Made 1.82
  // PP-eligible starters: ~1.1–1.5× DB mean
  NBA: {
    "Points":          { mean: 18.5, std:  8.5 },
    "Rebounds":        { mean:  6.0, std:  3.6 },
    "Assists":         { mean:  4.5, std:  2.9 },
    "Blocked Shots":   { mean:  1.1, std:  0.92 }, // was "blocks"     → DEFAULT fallthrough
    "Steals":          { mean:  1.2, std:  0.92 },
    "Turnovers":       { mean:  2.2, std:  1.50 },
    "3-PT Made":       { mean:  2.2, std:  1.70 }, // was "threes_made" → DEFAULT fallthrough
    "Pts+Rebs+Asts":   { mean: 28.2, std: 11.0  },
    "Pts+Rebs":        { mean: 24.3, std: 10.0  },
    "Pts+Asts":        { mean: 22.4, std:  9.6  },
    "Rebs+Asts":       { mean:  9.7, std:  5.0  },
    "Minutes":         { mean: 30.0, std:  6.5  },
  },

  // ── MLB ──────────────────────────────────────────────────────────────────
  // DB all-player means — hitters (90k rows):
  //   Hits 0.86/0.89, Singles 0.55/0.72, Doubles 0.17/0.41, Triples 0.016/0.13,
  //   HR 0.125/0.36, TB 1.43/1.79, RBIs 0.45/0.84, Runs 0.47/0.68,
  //   Walks 0.33/0.58, SB 0.08/0.30, HK 0.82/0.86, H+R+RBIs 1.77/1.96
  // DB all-player means — pitchers (6k rows):
  //   PitcherK 5.16/2.47, PO 16.4/3.79, HA 5.12/2.21, WA 1.67/1.27, ERA 2.45/1.98
  // PP-eligible hitters: ~1.1–1.7× DB mean (power/speed guys get disproportionate props)
  MLB: {
    // Hitter stats
    "Hits":                { mean: 1.00, std: 0.92 },
    "Singles":             { mean: 0.65, std: 0.76 },
    "Doubles":             { mean: 0.23, std: 0.44 },
    "Triples":             { mean: 0.03, std: 0.17 },
    "Home Runs":           { mean: 0.21, std: 0.42 },
    "Total Bases":         { mean: 1.60, std: 1.40 },
    "RBIs":                { mean: 0.70, std: 0.90 }, // was "RBI"          → DEFAULT (mean=20)
    "Runs":                { mean: 0.75, std: 0.78 },
    "Walks":               { mean: 0.65, std: 0.72 },
    "Stolen Bases":        { mean: 0.18, std: 0.42 },
    "Hitter Strikeouts":   { mean: 1.10, std: 1.00 }, // was missing         → DEFAULT (mean=20)
    "Hits+Runs+RBIs":      { mean: 2.45, std: 2.00 }, // was "Hits+Runs+RBI" → DEFAULT (mean=20)
    // Pitcher stats
    "Pitcher Strikeouts":  { mean: 7.00, std: 2.40 }, // was "strikeouts"    → ambiguous key
    "Walks Allowed":       { mean: 2.20, std: 1.45 },
    "Earned Runs Allowed": { mean: 2.60, std: 2.00 },
    "Hits Allowed":        { mean: 5.50, std: 2.25 },
    "Pitching Outs":       { mean: 15.5, std: 4.00 }, // ~5.2 IP = 15.6 outs
  },

  // ── NHL ──────────────────────────────────────────────────────────────────
  // DB all-player means (8.8k rows):
  //   Goals 0.21/0.47, Assists 0.37/0.63, Goal+Assist 0.57/0.80,
  //   PPP 0.13/0.39, SOG 1.89/1.64
  // PP-eligible forwards/D: ~1.5–2× DB mean
  NHL: {
    "Goals":               { mean: 0.42, std: 0.62 },
    "Assists":             { mean: 0.58, std: 0.74 },
    "Goal + Assist":       { mean: 0.78, std: 0.90 }, // was missing → DEFAULT (mean=20)
    "Power Play Points":   { mean: 0.24, std: 0.48 }, // was missing → DEFAULT (mean=20)
    "Shots On Goal":       { mean: 3.00, std: 1.95 }, // was "shots"  → DEFAULT (mean=20)
    "Points":              { mean: 0.72, std: 0.82 }, // general G+A points
    "Saves":               { mean: 27.0, std: 8.50 }, // goalies
  },

  // ── NFL ──────────────────────────────────────────────────────────────────
  // DB all-player means include non-specialists (e.g. WRs in Pass Yards average,
  // non-RBs in Rush Yards average), so all-player means are far below starter means.
  // PP-eligible starters: QBs, RB1s, WR1/2s, TE1s
  //   Pass Yards: all 24.5 → starter QBs ~250
  //   Rush Yards: all 11.8 → starter RBs ~70
  //   Receiving Yards: all 24.0 → starter WRs/TEs ~58
  //   Receptions: all 2.2 → starters ~5.5
  NFL: {
    "Pass Yards":       { mean: 250,  std: 65   }, // was "passing yards"  → DEFAULT (mean=20)
    "Rush Yards":       { mean:  70,  std: 42   }, // was "rushing yards"  → DEFAULT (mean=20)
    "Receiving Yards":  { mean:  58,  std: 36   }, // was "receiving yards"→ worked via normalization
    "Receptions":       { mean:   5.5, std: 2.8  },
    "Pass TDs":         { mean:   1.50, std: 1.05 }, // was generic "touchdowns" → DEFAULT
    "Rush TDs":         { mean:   0.55, std: 0.72 }, // was missing → DEFAULT (mean=20)
    "Rec TDs":          { mean:   0.42, std: 0.65 }, // was missing → DEFAULT (mean=20)
    // DB: Sacks mean 2.6, n=1034, 0 zeros — likely team sacks or position starters only.
    // Individual DE/LB who gets PP props: ~0.75 sacks/game.
    "Sacks":            { mean:  0.75, std: 0.95 },
    // DB: Interceptions mean 1.4, n=576, 0 zeros — likely QB INTs thrown for starters.
    "Interceptions":    { mean:  1.10, std: 0.80 },
    "Passing Attempts": { mean: 36,   std:  9   },
    "Completions":      { mean: 23,   std:  6   },
  },

  // ── WNBA ─────────────────────────────────────────────────────────────────
  WNBA: {
    "Points":            { mean: 13.5, std: 6.2  },
    "Rebounds":          { mean:  5.2, std: 2.8  },
    "Assists":           { mean:  3.0, std: 2.2  },
    "Steals":            { mean:  1.0, std: 0.7  },
    "Blocks":            { mean:  0.6, std: 0.5  },
    "Turnovers":         { mean:  1.8, std: 1.2  },
    "3-PT Made":         { mean:  1.2, std: 1.05 },
    "3-Pointers Made":   { mean:  1.2, std: 1.05 }, // alias used by some WNBA data feeds
    "Pts+Rebs+Asts":     { mean: 21.7, std: 8.5  },
    "Pts+Rebs":          { mean: 18.7, std: 7.8  },
    "Pts+Asts":          { mean: 16.5, std: 7.2  },
    "Rebs+Asts":         { mean:  8.2, std: 4.0  },
    "Fantasy Score":     { mean: 28.0, std: 10.5 },
  },
};

/**
 * Fallback prior for unknown sport×stat combinations.
 *
 * IMPORTANT: reaching this means a stat type is missing from PRIORS above.
 * The old value was { mean: 20, std: 8 } — catastrophically wrong for sparse stats
 * (pOverLine(20, 8, 0.5) ≈ 99.4%). When blended via Bayesian shrinkage (34.8%
 * weight at n=15 games), a player averaging 0.6 RBIs/game got a blended mean of
 * 7.4, yielding pOver ≈ 97%. The new default is still a placeholder — add the
 * missing sport+stat to PRIORS above to fix properly.
 */
const DEFAULT_PRIOR: Prior = { mean: 2.5, std: 3.0 };

export function getPrior(sport: string, statType: string): Prior {
  // 1. Exact canonical match — preferred; keys in PRIORS match DB stat_type strings
  const exact = PRIORS[sport]?.[statType];
  if (exact) return exact;

  // 2. Lowercase fallback for any legacy lowercase keys in the table
  const lower = statType.toLowerCase();
  const lowerMatch = PRIORS[sport]?.[lower];
  if (lowerMatch) return lowerMatch;

  // 3. Cross-sport fallback: a handful of stat types appear in multiple sports
  //    (e.g. "Points" in NBA and NHL) but a sport may only have one entry.
  //    Try other sports as a last resort rather than returning the bad default.
  for (const otherSport of Object.keys(PRIORS)) {
    if (otherSport === sport) continue;
    const fb = PRIORS[otherSport][statType] ?? PRIORS[otherSport][lower];
    if (fb) return fb;
  }

  return DEFAULT_PRIOR;
}

/**
 * Returns the sport-specific minimum games required for a full-confidence projection.
 * Sports with more variance (MLB) need more samples.
 */
export function minGamesForConfidence(sport: string): number {
  return { NBA: 8, MLB: 15, NHL: 10, NFL: 6, WNBA: 8 }[sport] ?? 8;
}
