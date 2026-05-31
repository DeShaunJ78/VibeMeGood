---
name: Slate list route fix
description: ourProjectionsTable vs projectionsTable — which to use in slate routes
---

# Slate Route — Use ourProjectionsTable

**Rule:** Always join `ourProjectionsTable` (table: `our_projections`) for projection data in slate list and detail routes. Never use `projectionsTable` (table: `projections`).

**Why:** `projectionsTable` has only 18 seeded legacy rows. `ourProjectionsTable` has 2,374+ real computed projections with pOver, projectedValue, stdDev, etc. Using the wrong table caused all 7,454 slate props to show null yourProjection and pOver, and edgeScores were computed without pOver data.

**How to apply:** Any new route that needs player projections must import from `../db` and use `ourProjectionsTable`, not `projectionsTable`.
