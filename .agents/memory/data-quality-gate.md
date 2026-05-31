---
name: data-quality gate
description: The automated data-quality check script, its soft/hard tiers, and the dataset quirks that shape which assertions are valid.
---

# Data-quality gate

A read-only assertion script (`scripts/src/data-quality-check.ts`, npm `data-quality`,
registered validation command `dataquality`) runs all five mandatory DQ categories
(null / format / referential-orphans / boundary / uniqueness) against the live DB and
exits non-zero on hard violations. Add a check by appending to `CHECKS`; each SQL must
return a single int column `n` (0 = pass).

## Why a script instead of FK constraints
Retrofitting FKs to all ~12 tables is a risky migration, and some references are
polymorphic and cannot be FK'd (e.g. `alerts.relatedEntityId`). The script detects
orphans via LEFT JOIN instead. `pp_lines` already has real FKs.

## Soft vs hard tier
`soft: true` checks report WARN and do NOT fail the gate. Reserve them for things that
are NOT schema-declared invariants or are expected by design:
- `pp_line_history` orphans — append-only audit log; snapshots intentionally outlive a
  delisted `pp_line` (hundreds of thousands of expected orphans).
- `teams (sport, abbreviation)` dups — no declared unique index; loose data.
- `prop_scores` multiple rows per `pp_line_id` — only a non-unique index; scores accumulate.

## Dataset quirks that invalidate "obvious" assertions
**Why these matter:** naive DQ rules produce false positives against this data model.
- `teams` holds free-form cross-sport identifiers (golf player names, esports orgs,
  combo codes like `COL/LAD`), NOT 2-5 letter abbreviations. Only assert non-blank.
- `prop_scores.action_tag` enum is `PLAY | WATCH | PASS | NO-PLAY` (schema comment was
  stale and omitted NO-PLAY).
- `pp_lines.line_value` is legitimately negative for spreads / certain goblin lines, so
  assert presence + sane magnitude, never `> 0`.
