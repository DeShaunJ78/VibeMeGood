---
name: Entry pick projection snapshot
description: Why logged entry picks must capture the model projection server-side, and how the AI entry analysis reads picks.
---

Logged `entry_picks` must carry a **snapshot** of the model projection
(`your_projection` / `projection_gap`) taken at log time. These power the Journal,
the AI entry analysis (`POST /api/explain/entry/:id`), and Review/CLV math.

**Rule:** snapshot projections **server-side** in `createEntry`, never trust the
client to send them. The client frequently logs picks (from the Slate cart or a
hand-typed slip) without projection fields, which left every leg's projection null
even though the model data existed — making the AI analysis report "no projections,
not model-driven" when in fact the metrics were just never captured.

**How to apply:**
- `our_projections` is **unique per (player_id, stat_type)**, so look up the
  projection by `playerId + statType` (picks often have no `pp_line_id`). One row
  per key — unambiguous.
- `yourProjection = projectedValue`; `projectionGap = projectedValue − lineValue`
  (same orientation the Slate Board uses: positive gap favors a `more` bet).
- Only fill when the pick's projection is null and a matching row exists — never
  overwrite an explicit client value.
- The model projections themselves are NOT the problem: `our_projections` is
  populated and is what the Slate Board + Lineup Factory read live. Lineup
  construction already uses current metrics; the gap was only in *logged-entry
  capture* and *analysis display*.

**AI entry-analysis prompt must include player names.** `explain/entry/:id` builds
its prompt from `entry_picks`, where `player_name` is usually null (resolved at read
time via `playerId → players.fullName`). If you don't resolve and inject the name,
the model literally responds "without player names I can't confirm correlation."
Always map playerIds → fullName and add a `player` field to each pick in the prompt.
