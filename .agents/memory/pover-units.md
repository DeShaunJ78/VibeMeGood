---
name: pOver units in slate/factory
description: pOverLine() returns a 0..100 percentage, NOT a 0..1 fraction — a recurring source of x100 scaling bugs.
---

`pOverLine(mean, stdDev, line)` and the stored `pp_lines`/projection pOver values are **percentages in 0..100**, not fractions.

**Why:** A demon-line pOver came back as 9752.5 instead of 97.5 because the value was multiplied by 100 again on display, and the EV-preserving multiplier estimate was fed a 0..100 value where it expected 0..1.

**How to apply:**
- `effectivePayoutMultiplier(...)` (api-server/src/lib/payout/multiplier.ts) expects tierPOver/standardPOver as **0..1 fractions** — divide pOverLine output by 100 before calling it, and divide stored pOver by 100 when building any standardPOverMap.
- For raw display of pOver in API responses, the value is already 0..100 — do NOT multiply by 100.
- lineup-factory.ts already converts pOver to 0..1 (pOverLine/100) before use; slate.ts must do the same conversion explicitly.
