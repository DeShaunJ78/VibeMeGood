/**
 * Stat-type normalisation — shared across auto-grading, projection, and calibration.
 *
 * Canonical stat_type values are exactly what historical-stats.ts writes into
 * player_game_logs (they are the source of truth). Keys in this map are all the
 * abbreviations and alternate spellings that PrizePicks or other data sources
 * may use; values are the canonical DB strings.
 *
 * Aliases verified against:
 *   - historical-stats.ts (NBA/MLB/NHL/NFL upsert arrays)
 *   - priors.ts PRIORS keys (must match to avoid DEFAULT_PRIOR fallthrough)
 *   - SELECT DISTINCT stat_type FROM player_game_logs (live DB audit)
 *
 * Add mappings here whenever a new mismatch is discovered; never duplicate
 * this map in individual modules.
 */

export const STAT_TYPE_ALIASES: Record<string, string> = {
  // ── NBA ──────────────────────────────────────────────────────────────────
  // Canonical: "Points", "Rebounds", "Assists", "Steals", "Blocked Shots",
  //            "Turnovers", "3-PT Made", "Pts+Rebs+Asts", "Pts+Rebs",
  //            "Pts+Asts", "Rebs+Asts"
  PTS:                    "Points",
  REB:                    "Rebounds",
  AST:                    "Assists",
  STL:                    "Steals",
  BLK:                    "Blocked Shots",
  "Blocks":               "Blocked Shots",   // PP sometimes uses short form
  "Blks":                 "Blocked Shots",
  TO:                     "Turnovers",
  TOV:                    "Turnovers",
  "3PM":                  "3-PT Made",
  "3-Pointers Made":      "3-PT Made",
  "3 Pointers Made":      "3-PT Made",
  "Threes Made":          "3-PT Made",
  FGA:                    "Field Goals Attempted",
  FGM:                    "Field Goals Made",
  FTA:                    "Free Throws Attempted",
  FTM:                    "Free Throws Made",

  // ── MLB — hitters ─────────────────────────────────────────────────────────
  // Canonical: "Hits", "Singles", "Doubles", "Triples", "Home Runs",
  //            "Total Bases", "RBIs", "Runs", "Walks", "Stolen Bases",
  //            "Hitter Strikeouts", "Hits+Runs+RBIs"
  HR:                     "Home Runs",
  "Home Run":             "Home Runs",
  RBI:                    "RBIs",
  SB:                     "Stolen Bases",
  BB:                     "Walks",
  "Walks (Batter)":       "Walks",
  "Strikeouts (Batter)":  "Hitter Strikeouts",
  "Batter Strikeouts":    "Hitter Strikeouts",
  "K (Batter)":           "Hitter Strikeouts",
  "H+R+RBI":              "Hits+Runs+RBIs",
  "Hits+Runs+RBI":        "Hits+Runs+RBIs",

  // ── MLB — pitchers ────────────────────────────────────────────────────────
  // Canonical: "Pitcher Strikeouts", "Walks Allowed", "Hits Allowed",
  //            "Earned Runs Allowed", "Pitching Outs"
  // NOTE: "IP" (Innings Pitched) is stored as "Pitching Outs" in the DB
  //       (1 IP = 3 outs).  Map common display forms to the stored canonical.
  IP:                     "Pitching Outs",
  "Innings Pitched":      "Pitching Outs",
  ER:                     "Earned Runs Allowed",
  "Earned Runs":          "Earned Runs Allowed",
  "K (Pitcher)":          "Pitcher Strikeouts",
  "Strikeouts (Pitcher)": "Pitcher Strikeouts",
  "Pitcher Ks":           "Pitcher Strikeouts",
  "Walks (Pitcher)":      "Walks Allowed",
  "BB Allowed":           "Walks Allowed",
  "HA":                   "Hits Allowed",
  "H Allowed":            "Hits Allowed",

  // ── NHL ──────────────────────────────────────────────────────────────────
  // Canonical: "Goals", "Assists", "Shots On Goal", "Power Play Points",
  //            "Goal + Assist"  (historical-stats.ts line 666–672)
  SOG:                    "Shots On Goal",
  "Shots":                "Shots On Goal",
  "Shots on Goal":        "Shots On Goal",   // lowercase "on" variant
  "Goals + Assists":      "Goal + Assist",
  "G+A":                  "Goal + Assist",
  PPP:                    "Power Play Points",
  "PP Points":            "Power Play Points",

  // ── NFL ──────────────────────────────────────────────────────────────────
  // Canonical: "Pass Yards", "Rush Yards", "Receiving Yards", "Receptions",
  //            "Rush TDs", "Rec TDs", "Pass TDs", "Interceptions", "Sacks"
  //            (historical-stats.ts line 832–844)
  PassYds:                "Pass Yards",
  "Passing Yards":        "Pass Yards",
  "Pass Yds":             "Pass Yards",
  "Passing Yds":          "Pass Yards",
  RushYds:                "Rush Yards",
  "Rushing Yards":        "Rush Yards",
  "Rush Yds":             "Rush Yards",
  "Rushing Yds":          "Rush Yards",
  RecYds:                 "Receiving Yards",
  "Rec Yards":            "Receiving Yards",
  "Rec Yds":              "Receiving Yards",
  "Receiving Yds":        "Receiving Yards",
  Rec:                    "Receptions",
  "Catches":              "Receptions",
  PassTD:                 "Pass TDs",
  "Passing TDs":          "Pass TDs",
  "Passing Touchdowns":   "Pass TDs",
  "Pass Touchdowns":      "Pass TDs",
  RushTD:                 "Rush TDs",
  "Rushing TDs":          "Rush TDs",
  "Rushing Touchdowns":   "Rush TDs",
  RecTD:                  "Rec TDs",
  "Receiving TDs":        "Rec TDs",
  "Receiving Touchdowns": "Rec TDs",
  PassAtt:                "Passing Attempts",
  "Pass Attempts":        "Passing Attempts",
  "Pass Att":             "Passing Attempts",
  "QB Completions":       "Completions",
  "INT":                  "Interceptions",
};

/**
 * Case-insensitive reverse index: canonical.toLowerCase() → canonical (original case).
 * Used to handle callers that pass a canonical in the wrong case.
 */
const canonicalByLower: Record<string, string> = {};
for (const canonical of Object.values(STAT_TYPE_ALIASES)) {
  canonicalByLower[canonical.toLowerCase()] = canonical;
}

/**
 * Resolve any stat-type string to its canonical DB form.
 *
 * Resolution order:
 *   1. Exact key in STAT_TYPE_ALIASES → canonical value
 *   2. Input lowercased matches a known canonical → return correct-cased canonical
 *   3. Otherwise return input unchanged (assumed already canonical or unknown)
 */
export function normalizeStatType(s: string): string {
  const direct = STAT_TYPE_ALIASES[s];
  if (direct != null) return direct;

  const fromLower = canonicalByLower[s.toLowerCase()];
  if (fromLower != null) return fromLower;

  return s;
}

/**
 * Return every stat-type form that a game-log lookup should try for `s`.
 *
 * Emits 1–N distinct strings; always starts with `normalizeStatType(s)` so
 * callers can short-circuit on the first hit. Includes the raw input and all
 * abbreviations that alias to the same canonical — useful when the pick was
 * stored with the canonical but the log uses the abbreviation (rare but real).
 */
export function statTypeCandidates(s: string): string[] {
  const canonical = normalizeStatType(s);
  const seen = new Set<string>([canonical]);

  if (!seen.has(s)) seen.add(s);

  for (const [abbrev, can] of Object.entries(STAT_TYPE_ALIASES)) {
    if (can === canonical && !seen.has(abbrev)) seen.add(abbrev);
  }

  return Array.from(seen);
}
