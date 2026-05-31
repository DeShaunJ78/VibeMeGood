---
name: Single-sport lineup factory
description: Why each generated lineup must be locked to one sport, and where the constraint must live.
---

The lineup factory builds candidate lineups from a **global, cross-sport candidate pool**. Without an explicit per-lineup sport lock, a single lineup mixes players from different sports (NBA + tennis + soccer), which is invalid for the user's slips.

**Rule:** Each lineup tracks its own `lineupSport` (null until the first accepted pick sets it). Every subsequent candidate must match that sport, and the constraint must be enforced in **both** the main selection loop **and** the relaxed fallback loop — missing it in the fallback re-introduces mixed-sport lineups when the main pass can't fill a lineup.

**Why:** The user reported "loaded lineups are MIXED SPORTS." The factory had no per-lineup sport constraint at all.

**How to apply:** When touching `artifacts/api-server/src/routes/lineup-factory.ts`, preserve the `lineupSport` lock on every push path. Verify by curling the factory endpoint and confirming each returned lineup has a single distinct sport across its legs.
