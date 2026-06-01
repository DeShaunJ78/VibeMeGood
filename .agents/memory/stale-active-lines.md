---
name: Stale active pp_lines leak into dashboard
description: Why off-season / stale props appear in Command Center sections and how to scope them out.
---

# Stale active pp_lines leak off-season props

`pp_lines` rows with `isActive = true` AND `lastSyncedAt IS NULL` (e.g. seed data) pass the dashboard's "active lines" freshness filter forever (the query is `isActive AND (lastSyncedAt IS NULL OR lastSyncedAt >= now-12h)`). They are never tied to a current game, so any view that lists "active lines" without slate-scoping surfaces stale off-season props (wrong sport, opponent shows "—", degenerate identical 99%/0.5/edge values, all NO-PLAY/gated).

- The reliable "current slate" signal is whether the player's TEAM plays today: build `gamesByTeam` from `todaysGames` (games with `startTime` in [startOfToday, endOfToday)) and require `gamesByTeam[player.teamId]` to exist. `pp_lines.gameId` is also set at sync time only when a game is today, but team→today's-game is more robust.
- "Top Picks"-style sections must also drop gated (`our_projections.noPlayReason` set) and `propScores.actionTag === "NO-PLAY"`, or the list is a wall of avoid-these props.
- Do NOT add a "next upcoming slate" fallback to fill an empty card — future-dated seed games can re-surface the exact off-season props the user rejected. Empty + honest message ("No games in today's slate") is correct off-hours.

**Why:** dev and prod both carried off-season NFL/NHL seed lines that rendered as "Top Picks" in June. User explicitly rejected seeing NFL.
**How to apply:** when building any "current"/"top" line list on the dashboard or similar, slate-scope by team-plays-today and exclude gated/NO-PLAY; never rely on the active-lines freshness filter alone.
