// Automated data-quality gate for the PrizePicks Analytics database.
//
// Runs read-only assertions across all five mandatory data-quality categories and
// exits non-zero if ANY violation is found, so it can be wired into CI / validation:
//   1. Null values in mandatory (logically-required) fields
//   2. Data type & format compliance (enum membership, regex)
//   3. Referential integrity & orphan records
//   4. Boundary values & numerical ranges
//   5. Uniqueness & duplicate constraints
//
// This is intentionally read-only (SELECT count(*) per check) and safe to run in any
// environment. Add a new check by appending to CHECKS — keep each SQL returning a
// single integer column `n` = number of offending rows (0 = pass).

import { pool } from "@workspace/db";

type Category =
  | "null"
  | "format"
  | "referential"
  | "boundary"
  | "uniqueness";

interface Check {
  category: Category;
  name: string;
  sql: string;
  // Soft checks report as WARN and do NOT fail the gate. Used for non-declared
  // "constraints" (loose natural keys) and append-only audit tables where
  // orphaned references are expected by design rather than corruption.
  soft?: boolean;
}

// Helper to build an orphan-record check: child.fk set but no matching parent row.
function orphan(
  child: string,
  fk: string,
  parent: string,
  parentKey = "id",
  soft = false,
): Check {
  return {
    category: "referential",
    name: `${child}.${fk} -> ${parent}.${parentKey}`,
    soft,
    sql: `SELECT count(*)::int AS n FROM ${child} c
          LEFT JOIN ${parent} p ON c.${fk} = p.${parentKey}
          WHERE c.${fk} IS NOT NULL AND p.${parentKey} IS NULL`,
  };
}

const CHECKS: Check[] = [
  // ---- 1. NULL in mandatory / logically-required fields ----
  {
    category: "null",
    name: "our_projections.player_id present",
    sql: `SELECT count(*)::int AS n FROM our_projections WHERE player_id IS NULL`,
  },
  {
    category: "null",
    name: "our_projections: p_over present when std_dev is set",
    sql: `SELECT count(*)::int AS n FROM our_projections WHERE std_dev IS NOT NULL AND p_over IS NULL`,
  },
  {
    category: "null",
    name: "entries.stake present",
    sql: `SELECT count(*)::int AS n FROM entries WHERE stake IS NULL`,
  },

  // ---- 2. Type / format compliance (enum membership + regex) ----
  {
    category: "format",
    name: "pp_lines.line_type in (standard|demon|goblin)",
    sql: `SELECT count(*)::int AS n FROM pp_lines WHERE line_type NOT IN ('standard','demon','goblin')`,
  },
  {
    category: "format",
    name: "pp_lines.pick_category in (player|team|culture)",
    sql: `SELECT count(*)::int AS n FROM pp_lines WHERE pick_category NOT IN ('player','team','culture')`,
  },
  {
    category: "format",
    name: "entries.entry_type in (power|flex)",
    sql: `SELECT count(*)::int AS n FROM entries WHERE entry_type NOT IN ('power','flex')`,
  },
  {
    category: "format",
    name: "entries.result in (pending|win|loss|partial|refund)",
    sql: `SELECT count(*)::int AS n FROM entries WHERE result NOT IN ('pending','win','loss','partial','refund')`,
  },
  {
    category: "format",
    name: "prop_scores.action_tag in (PLAY|WATCH|PASS|NO-PLAY)",
    sql: `SELECT count(*)::int AS n FROM prop_scores WHERE action_tag NOT IN ('PLAY','WATCH','PASS','NO-PLAY')`,
  },
  {
    // teams holds free-form cross-sport identifiers (golf players, esports orgs,
    // combo abbreviations like COL/LAD), not fixed 2-5 letter codes. The real
    // invariant here is simply that an abbreviation is non-blank.
    category: "format",
    name: "teams.abbreviation non-blank",
    sql: `SELECT count(*)::int AS n FROM teams WHERE abbreviation IS NULL OR btrim(abbreviation) = ''`,
  },

  // ---- 3. Referential integrity / orphan records ----
  orphan("games", "home_team_id", "teams"),
  orphan("games", "away_team_id", "teams"),
  orphan("players", "team_id", "teams"),
  // pp_line_history is an append-only audit log: snapshots intentionally outlive
  // the pp_lines they reference once a line is delisted, so orphans are expected.
  orphan("pp_line_history", "pp_line_id", "pp_lines", "id", true),
  orphan("external_lines", "pp_line_id", "pp_lines"),
  orphan("external_lines", "player_id", "players"),
  orphan("injuries", "player_id", "players"),
  orphan("injuries", "game_id", "games"),
  orphan("lineup_confirmations", "player_id", "players"),
  orphan("lineup_confirmations", "game_id", "games"),
  orphan("projections", "player_id", "players"),
  orphan("projections", "game_id", "games"),
  orphan("prop_scores", "player_id", "players"),
  orphan("prop_scores", "game_id", "games"),
  orphan("prop_scores", "pp_line_id", "pp_lines"),
  orphan("entry_picks", "entry_id", "entries"),
  orphan("entry_picks", "player_id", "players"),
  orphan("entry_picks", "game_id", "games"),
  orphan("entry_picks", "pp_line_id", "pp_lines"),
  orphan("watchlist_items", "player_id", "players"),
  orphan("watchlist_items", "game_id", "games"),
  orphan("our_projections", "player_id", "players"),
  orphan("our_projections", "game_id", "games"),
  orphan("messages", "conversation_id", "conversations"),

  // ---- 4. Boundary values / numeric ranges ----
  {
    // Raw line_value may legitimately be negative (spreads, certain goblin lines).
    // The real invariant is that it is present and not an absurd magnitude.
    category: "boundary",
    name: "pp_lines.line_value present and |value| <= 100000",
    sql: `SELECT count(*)::int AS n FROM pp_lines WHERE line_value IS NULL OR abs(line_value) > 100000`,
  },
  {
    // Override mirrors the raw line domain (negatives allowed for spreads); bound
    // magnitude only, consistent with the PATCH /pp-lines/:id/overrides contract.
    category: "boundary",
    name: "pp_lines.line_value_override |value| <= 10000",
    sql: `SELECT count(*)::int AS n FROM pp_lines WHERE line_value_override IS NOT NULL AND abs(line_value_override) > 10000`,
  },
  {
    category: "boundary",
    name: "pp_lines.payout_multiplier in [0.1, 10]",
    sql: `SELECT count(*)::int AS n FROM pp_lines WHERE payout_multiplier IS NOT NULL AND (payout_multiplier < 0.1 OR payout_multiplier > 10)`,
  },
  {
    category: "boundary",
    name: "our_projections.p_over in [0, 100]",
    sql: `SELECT count(*)::int AS n FROM our_projections WHERE p_over IS NOT NULL AND (p_over < 0 OR p_over > 100)`,
  },
  {
    category: "boundary",
    name: "our_projections.percentile_at_line in [0, 100]",
    sql: `SELECT count(*)::int AS n FROM our_projections WHERE percentile_at_line IS NOT NULL AND (percentile_at_line < 0 OR percentile_at_line > 100)`,
  },
  {
    category: "boundary",
    name: "our_projections.data_quality_score in [0, 100]",
    sql: `SELECT count(*)::int AS n FROM our_projections WHERE data_quality_score IS NOT NULL AND (data_quality_score < 0 OR data_quality_score > 100)`,
  },
  {
    category: "boundary",
    name: "our_projections.shrinkage_factor in [0, 1]",
    sql: `SELECT count(*)::int AS n FROM our_projections WHERE shrinkage_factor IS NOT NULL AND (shrinkage_factor < 0 OR shrinkage_factor > 1)`,
  },
  {
    category: "boundary",
    name: "our_projections.std_dev >= 0",
    sql: `SELECT count(*)::int AS n FROM our_projections WHERE std_dev IS NOT NULL AND std_dev < 0`,
  },
  {
    category: "boundary",
    name: "prop_scores edge/stability/market/risk/final in [0, 100]",
    sql: `SELECT count(*)::int AS n FROM prop_scores
          WHERE edge_score < 0 OR edge_score > 100
             OR stability_score < 0 OR stability_score > 100
             OR market_support_score < 0 OR market_support_score > 100
             OR risk_score < 0 OR risk_score > 100
             OR final_score < 0 OR final_score > 100`,
  },
  {
    category: "boundary",
    name: "entries.stake >= 0",
    sql: `SELECT count(*)::int AS n FROM entries WHERE stake < 0`,
  },
  {
    category: "boundary",
    name: "entries.pick_count in [2, 6]",
    sql: `SELECT count(*)::int AS n FROM entries WHERE pick_count < 2 OR pick_count > 6`,
  },

  // ---- 5. Uniqueness / duplicate constraints ----
  {
    category: "uniqueness",
    name: "pp_lines unique (player_id, stat_type, line_value, line_type)",
    sql: `SELECT count(*)::int AS n FROM (
            SELECT 1 FROM pp_lines GROUP BY player_id, stat_type, line_value, line_type HAVING count(*) > 1
          ) d`,
  },
  {
    category: "uniqueness",
    name: "our_projections unique (player_id, stat_type)",
    sql: `SELECT count(*)::int AS n FROM (
            SELECT 1 FROM our_projections GROUP BY player_id, stat_type HAVING count(*) > 1
          ) d`,
  },
  {
    // Not a schema-declared unique index; teams is reused loosely across sports
    // (golf/soccer free-form entries), so this is advisory only.
    category: "uniqueness",
    name: "teams unique (sport, abbreviation)",
    soft: true,
    sql: `SELECT count(*)::int AS n FROM (
            SELECT 1 FROM teams GROUP BY sport, abbreviation HAVING count(*) > 1
          ) d`,
  },
  {
    // prop_scores has only a non-unique index; scores can accumulate per line
    // over time, so multiple rows per pp_line_id are not necessarily corruption.
    category: "uniqueness",
    name: "prop_scores one row per pp_line_id",
    soft: true,
    sql: `SELECT count(*)::int AS n FROM (
            SELECT 1 FROM prop_scores GROUP BY pp_line_id HAVING count(*) > 1
          ) d`,
  },
];

const CATEGORY_LABEL: Record<Category, string> = {
  null: "1. NULL in mandatory fields",
  format: "2. Type / format compliance",
  referential: "3. Referential integrity / orphans",
  boundary: "4. Boundary values / numeric ranges",
  uniqueness: "5. Uniqueness / duplicates",
};

async function main(): Promise<void> {
  const results: Array<Check & { violations: number; error?: string }> = [];

  for (const check of CHECKS) {
    try {
      const { rows } = await pool.query<{ n: number }>(check.sql);
      results.push({ ...check, violations: rows[0]?.n ?? 0 });
    } catch (err) {
      results.push({ ...check, violations: -1, error: (err as Error).message });
    }
  }

  const order: Category[] = ["null", "format", "referential", "boundary", "uniqueness"];
  let totalViolations = 0;
  let totalWarnings = 0;
  let totalErrors = 0;

  console.log("\n=== Data Quality Report ===\n");
  for (const cat of order) {
    const inCat = results.filter((r) => r.category === cat);
    if (inCat.length === 0) continue;
    console.log(CATEGORY_LABEL[cat]);
    for (const r of inCat) {
      if (r.error) {
        totalErrors++;
        console.log(`  ERROR  ${r.name} — ${r.error}`);
      } else if (r.violations > 0 && r.soft) {
        totalWarnings += r.violations;
        console.log(`  WARN   ${r.name} — ${r.violations} row(s) (advisory)`);
      } else if (r.violations > 0) {
        totalViolations += r.violations;
        console.log(`  FAIL   ${r.name} — ${r.violations} offending row(s)`);
      } else {
        console.log(`  ok     ${r.name}`);
      }
    }
    console.log("");
  }

  console.log(
    `Summary: ${results.length} checks, ${totalViolations} violation(s), ${totalWarnings} advisory warning(s), ${totalErrors} error(s).`,
  );

  await pool.end();

  if (totalViolations > 0 || totalErrors > 0) {
    console.error("\nData quality gate FAILED.");
    process.exit(1);
  }
  console.log("\nData quality gate PASSED (advisory warnings do not block).");
  process.exit(0);
}

main().catch((err) => {
  console.error("data-quality-check crashed:", err);
  process.exit(1);
});
