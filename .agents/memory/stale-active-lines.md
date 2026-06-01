---
name: Stale active pp_lines leak into dashboard
description: Why off-season / stale props appear in Command Center sections and how to scope them out.
---

# Stale active pp_lines leak off-season props

The dashboard `activeLines` query is: `isActive = true AND (lastSyncedAt IS NULL OR lastSyncedAt >= now - 72h)`. Two failure modes:

**1. Stale seed data surfaces as Top Picks**
Seed lines with `lastSyncedAt IS NULL` pass the `IS NULL` branch forever. They are off-season props (wrong sport, opponent "—", degenerate 99% pOver, all NO-PLAY/gated). Fix: in `topProjProps` map, add `if (!line.lastSyncedAt) return null` — requires a real sync timestamp. Also drop `proj.noPlayReason` and `actionTag === "NO-PLAY"`.

**2. Window too tight → everything returns empty**
The original 12-hour window caused `activeLines = []` whenever the user hadn't synced in >12h (e.g. yesterday's sync still valid today). All KPI counts and Top Picks showed 0. Fix: use 72h — covers up to 3 days between syncs; `isActive` is the real freshness signal (sync sets lines inactive when PrizePicks removes them).

**Do NOT gate Top Picks on today's games table**
`games` table often has no entry for today even when PrizePicks has a live slate (especially if sync hasn't loaded today's schedule). Using `gamesByTeam[teamId]` as the gate makes Top Picks always empty. Opponent display is optional — show when available, null otherwise.

**Why:** user saw NFL off-season props in Top Picks in June; fixing it with a `games-today` gate then broke it entirely (empty card) because the games table had no June 1 entries.
**How to apply:** `isActive = true` + `lastSyncedAt NOT NULL` (in topProjProps) + exclude gated/NO-PLAY + 72h recency window for activeLines.
