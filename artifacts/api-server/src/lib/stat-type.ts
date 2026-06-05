/**
 * Stat-type normalisation — shared across auto-grading, projection, and calibration.
 *
 * PrizePicks and various stat providers use different names for the same stat.
 * All three surfaces that touch stat types (auto-grade, compute.ts, calibration)
 * must resolve to the SAME canonical string before hitting the DB so that:
 *   - game-log lookups find rows regardless of how the pick was imported
 *   - calibration bucket keys built from game logs are the same ones looked up
 *     at projection time
 *   - prior keys in priors.ts always match
 *
 * Canonical stat_type strings are what player_game_logs actually stores.
 * Add mappings here whenever a new mismatch is discovered; never duplicate
 * this map in individual modules.
 */

/** Abbreviations / alternate names → canonical DB stat_type string. */
export const STAT_TYPE_ALIASES: Record<string, string> = {
  // ── NBA ──────────────────────────────────────────────────────────────────
  PTS:                       "Points",
  REB:                       "Rebounds",
  AST:                       "Assists",
  STL:                       "Steals",
  BLK:                       "Blocks",
  "Blocked Shots":           "Blocks",      // PP sometimes uses long form
  "3PM":                     "3-PT Made",
  "3-Pointers Made":         "3-PT Made",
  "3 Pointers Made":         "3-PT Made",
  "3PA":                     "3-Point Attempts",
  "3-Pointers Attempted":    "3-Point Attempts",
  "3 Pointers Attempted":    "3-Point Attempts",
  TO:                        "Turnovers",
  FGA:                       "Field Goals Attempted",
  FGM:                       "Field Goals Made",
  FTA:                       "Free Throws Attempted",
  FTM:                       "Free Throws Made",
  // ── MLB ──────────────────────────────────────────────────────────────────
  H:                         "Hits",
  HR:                        "Home Runs",
  "Home Run":                "Home Runs",
  RBI:                       "RBIs",
  SB:                        "Stolen Bases",
  BB:                        "Walks",
  K:                         "Strikeouts",
  SO:                        "Strikeouts",
  ER:                        "Earned Runs",
  IP:                        "Innings Pitched",
  // ── NHL ──────────────────────────────────────────────────────────────────
  G:                         "Goals",
  "Shots":                   "Shots on Goal",
  SOG:                       "Shots on Goal",
  HIT:                       "Hits",         // context: NHL hits
  // ── NFL ──────────────────────────────────────────────────────────────────
  PassYds:                   "Passing Yards",
  "Pass Yds":                "Passing Yards",
  "Passing Yds":             "Passing Yards",
  RushYds:                   "Rushing Yards",
  "Rush Yds":                "Rushing Yards",
  RecYds:                    "Receiving Yards",
  "Rec Yds":                 "Receiving Yards",
  PassTD:                    "Passing TDs",
  "Pass TDs":                "Passing TDs",
  "Passing Touchdowns":      "Passing TDs",
  RushTD:                    "Rushing TDs",
  "Rush TDs":                "Rushing TDs",
  "Rushing Touchdowns":      "Rushing TDs",
  RecTD:                     "Receiving TDs",
  "Rec TDs":                 "Receiving TDs",
  "Receiving Touchdowns":    "Receiving TDs",
  Rec:                       "Receptions",
  PassAtt:                   "Pass Attempts",
  "Pass Att":                "Pass Attempts",
  RushAtt:                   "Rush Attempts",
  "Rush Att":                "Rush Attempts",
};

/** Reverse map: canonical (lowercased) → canonical (original case). */
const reverseAliases: Record<string, string> = {};
for (const canonical of Object.values(STAT_TYPE_ALIASES)) {
  reverseAliases[canonical.toLowerCase()] = canonical;
}

/**
 * Resolve a stat-type string to its canonical DB form.
 *
 * Resolution order:
 *   1. Exact key in STAT_TYPE_ALIASES → canonical value
 *   2. Input lowercased matches a canonical value → return canonical (fixes case drift)
 *   3. Otherwise return input unchanged (assumed already canonical)
 */
export function normalizeStatType(s: string): string {
  const direct = STAT_TYPE_ALIASES[s];
  if (direct != null) return direct;

  const fromReverse = reverseAliases[s.toLowerCase()];
  if (fromReverse != null) return fromReverse;

  return s;
}

/**
 * Return every stat-type form that a game-log lookup should try for `s`.
 * Used by the auto-grade resolver to find logs regardless of which direction
 * the mismatch runs (pick = abbreviation, log = canonical, or vice-versa).
 *
 * Emits 1–3 distinct strings; always includes `normalizeStatType(s)` first
 * so callers can short-circuit on the first hit.
 */
export function statTypeCandidates(s: string): string[] {
  const canonical = normalizeStatType(s);
  const seen = new Set<string>([canonical]);

  // Also try the raw input in case it was already the right form but didn't
  // match the alias map (e.g. a new stat type not yet in the map).
  if (!seen.has(s)) seen.add(s);

  // Reverse: if the input was a canonical and someone stored the abbreviation.
  for (const [abbrev, can] of Object.entries(STAT_TYPE_ALIASES)) {
    if (can === canonical && !seen.has(abbrev)) seen.add(abbrev);
  }

  return Array.from(seen);
}
