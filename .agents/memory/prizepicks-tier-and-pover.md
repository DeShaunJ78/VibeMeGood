---
name: PrizePicks tier field & per-line probability
description: How PP projections expose the goblin/demon tier, and why pOver must be computed per line not stored once per player/stat
---

# PrizePicks tier (`odds_type`) and tier-aware probability

## The tier field is `odds_type`, NOT `line_type`
The PrizePicks projections API (`/projections`) exposes the tier on
`attributes.odds_type` with values `standard | goblin | demon`. There is **no**
`line_type` attribute. Reading a non-existent field made every line default to
`"standard"`, which:
- collapsed goblin/demon into standard (broke the goblin alert + tier filters), and
- collided same-value standard+demon pairs on the upsert key
  `(playerId, statType, lineValue, lineType)` so only one survived — making the
  app's lines stop matching what PrizePicks shows on-site.

**How to apply:** any change to PP projection ingestion must map tier from
`odds_type`. Demon lines vastly outnumber standard on the live feed (e.g. ~5700
demon vs ~2100 standard), so a "mostly standard" distribution in the DB is a red
flag that tier parsing is broken again.

Stale mislabeled rows self-heal: the sync deactivates any active line whose
`lastSyncedAt` is >1h old, so old wrong-tier rows age out within an hour (or run
the same UPDATE manually to clear them immediately).

## Probability (pOver) is per-LINE, not per (player, stat)
`ourProjectionsTable` stores ONE row per `(playerId, statType)` (a projected mean
+ stdDev). Its stored `pOver` is computed in `upsertProjection` against a single
arbitrary active line (`.limit(1)`), so it is wrong for the other tiers of the
same stat (a goblin at 0.5 and a demon at 4.5 must NOT share a probability).

**Rule:** every consumer that evaluates probability against a specific PP line
must recompute `pOverLine(projectedValue, stdDev, line.lineValue)` at read time —
do not trust the stored `proj.pOver`. Consumers that do this: slate list + detail,
`recalcPropScores` (drives edgeScore/actionTag), lineup-factory hit probability,
market-intel projPOver/convergence. `pOverLine`/`percentileAtLine` live in
`lib/projection/normal-dist.ts`.

**Why:** keeping a single stored pOver was masked while all lines were mislabeled
"standard"; once tiers were split correctly, the shared pOver became visibly wrong
on every screen showing demon/goblin lines.

## Demon/goblin payouts are dynamic — never use the fixed Power/Flex table
PrizePicks scales the entry multiplier at slip-build time (depends on pick count +
mix of standard/demon/goblin), and only their app shows the exact number. So a slip
that contains ANY demon/goblin pick must NOT derive payout/EV from the fixed
Power/Flex multiplier table — that fabricates a wrong number and (worse) persists it
to the journal. Entry Builder requires the user to type the real multiplier read off
the PrizePicks app; until then payout/EV are blanked and LOG ENTRY is disabled.

For model-honesty the Slate Board shows the **break-even multiplier** (`BE × = 100/pOver`,
since demons/goblins are More-only so hit prob = pOver/100), not an estimated payout.

**More-only:** demon & goblin are strictly "More" — enforce at every pick source
(Prop Detail forces direction + hides LESS; Entry Builder has a useEffect safety net),
not just at one screen.

**How to apply:** any new surface that computes a demon/goblin payout must take a
user-entered multiplier; gate payout/EV/logging on it. Don't reintroduce a
per-line estimated multiplier.
