/**
 * Population-level priors for PrizePicks-eligible players (higher-usage starters/stars).
 * Used for Bayesian shrinkage when sample sizes are small.
 *
 * Sources: multi-season PrizePicks hit-rate analysis, sport stat distributions.
 * Update these from real calibration data once enough results accumulate.
 */

export interface Prior {
  mean: number;
  std: number;
}

/** Minimum games for a PLAY-eligible projection */
export const MIN_GAMES_FOR_PLAY = 1;

/** Shrinkage strength — equivalent to this many "prior games" */
export const SHRINKAGE_K = 8;

/** Data quality threshold below which we force NO-PLAY */
export const DQ_PLAY_THRESHOLD = 25;

/** Projection TTL — staleness gate in hours */
export const PROJECTION_TTL_HOURS = 6;

/**
 * Line-type adjustments to the effective standard deviation.
 * Goblin lines are set artificially low → same player distribution, more P(over).
 * Demon lines are set artificially high → same distribution, less P(over).
 * We don't adjust the mean — we let the math produce the right P(over).
 * The stdAdj widens variance slightly for exotic line types (less certainty about the line itself).
 */
export const LINE_TYPE_STD_ADJ: Record<string, number> = {
  goblin: 1.05,
  demon: 1.05,
  standard: 1.0,
};

/** Sport × stat population priors */
const PRIORS: Record<string, Record<string, Prior>> = {
  NBA: {
    points:             { mean: 18.5, std: 8.2  },
    rebounds:           { mean: 5.8,  std: 3.4  },
    assists:            { mean: 3.9,  std: 2.8  },
    threes_made:        { mean: 1.8,  std: 1.5  },
    blocks:             { mean: 0.9,  std: 0.8  },
    steals:             { mean: 0.9,  std: 0.7  },
    turnovers:          { mean: 2.1,  std: 1.3  },
    "Pts+Reb+Ast":      { mean: 28.2, std: 10.5 },
    "Pts+Reb":          { mean: 24.3, std: 9.8  },
    "Pts+Ast":          { mean: 22.4, std: 9.4  },
    "Reb+Ast":          { mean: 9.7,  std: 4.8  },
    minutes:            { mean: 30.0, std: 6.5  },
  },
  MLB: {
    hits:               { mean: 0.95, std: 0.88 },
    "Total Bases":      { mean: 1.4,  std: 1.2  },
    strikeouts:         { mean: 6.8,  std: 2.4  },
    runs:               { mean: 0.7,  std: 0.8  },
    RBI:                { mean: 0.6,  std: 0.8  },
    "Hits+Runs+RBI":    { mean: 2.2,  std: 1.8  },
    walks:              { mean: 0.8,  std: 0.7  },
  },
  NHL: {
    shots:              { mean: 2.8,  std: 1.9  },
    points:             { mean: 0.7,  std: 0.8  },
    saves:              { mean: 26.5, std: 8.5  },
    goals:              { mean: 0.4,  std: 0.6  },
    assists:            { mean: 0.5,  std: 0.7  },
  },
  NFL: {
    "passing yards":    { mean: 245,  std: 68   },
    "rushing yards":    { mean: 65,   std: 42   },
    "receiving yards":  { mean: 55,   std: 38   },
    receptions:         { mean: 5.2,  std: 2.8  },
    touchdowns:         { mean: 1.2,  std: 1.0  },
    "passing attempts": { mean: 35,   std: 9    },
    "completions":      { mean: 22,   std: 6    },
  },
  WNBA: {
    Points:               { mean: 13.5, std: 6.2  },
    Rebounds:             { mean: 5.2,  std: 2.8  },
    Assists:              { mean: 3.0,  std: 2.2  },
    Steals:               { mean: 1.0,  std: 0.7  },
    Blocks:               { mean: 0.6,  std: 0.5  },
    Turnovers:            { mean: 1.8,  std: 1.2  },
    "3-Pointers Made":    { mean: 1.0,  std: 1.0  },
    "Pts+Reb+Ast":        { mean: 21.7, std: 8.5  },
    "Pts+Reb":            { mean: 18.7, std: 7.8  },
    "Pts+Ast":            { mean: 16.5, std: 7.2  },
    "Reb+Ast":            { mean: 8.2,  std: 4.0  },
    "Fantasy Score":      { mean: 28.0, std: 10.5 },
    points:               { mean: 13.5, std: 6.2  },
    rebounds:             { mean: 5.2,  std: 2.8  },
    assists:              { mean: 3.0,  std: 2.2  },
  },
};

const DEFAULT_PRIOR: Prior = { mean: 20, std: 8 };

export function getPrior(sport: string, statType: string): Prior {
  // Normalize common aliases
  const normalized = statType
    .toLowerCase()
    .replace("3-pointers made", "threes_made")
    .replace("3 pointers made", "threes_made");
  return (
    PRIORS[sport]?.[statType] ??
    PRIORS[sport]?.[normalized] ??
    DEFAULT_PRIOR
  );
}

/**
 * Returns the sport-specific minimum games required for a full-confidence projection.
 * Sports with more variance (MLB) need more samples.
 */
export function minGamesForConfidence(sport: string): number {
  return { NBA: 8, MLB: 15, NHL: 10, NFL: 6, WNBA: 8 }[sport] ?? 8;
}
