# PrizePicks Analytics Workstation

Private full-stack analytics workstation for evaluating PrizePicks props. Dark terminal aesthetic, desktop-first.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/prizepicks run dev` — run the frontend (port assigned via $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed` — re-seed the database

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Wouter + Tailwind + shadcn/ui
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- AI: Anthropic Claude (SSE streaming for prop explain, regular chat for AI Analyst)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/prizepicks/src/pages/` — all 8 screen pages
- `artifacts/prizepicks/src/components/` — shared UI (PropDetailSheet, TeamPicksBoard, AppSidebar)
- `artifacts/prizepicks/src/lib/entry-context.tsx` — global picks cart (EntryBuilder context)
- `artifacts/api-server/src/routes/` — all Express route handlers
- `lib/db/src/schema/` — Drizzle ORM table definitions (source of truth)
- `lib/api-client-react/src/generated/` — generated Orval hooks + schemas (do not edit directly)
- `scripts/src/seed.ts` — seed script for local dev data
- `lib/openapi/` — OpenAPI spec (source of truth for codegen)

## Architecture decisions

- Contract-first: OpenAPI spec → Orval codegen → typed React Query hooks. Never call API manually in components.
- SSE streaming for AI prop explanations (`POST /api/explain/prop/:id`, `POST /api/explain/entry/:id`).
- Regular Anthropic messages API for AI Analyst chat (stored in `conversations`/`messages` DB tables).
- Early Exit eligibility and value stored on `entries` table (`earlyExitEligible`, `earlyExitValue`, `earlyExitUsed`).
- Team picks use `pickCategory: 'team'` on `pp_lines`; slate API returns `pickCategory/teamPickType/teamId`.
- Watchlist toggle on Slate Board uses `WatchlistItemInput` with `playerId` + `statType` (not ppLineId).

## Product — 8 Screens

1. **Command Center** — KPI cards (active props, watched, pending entries, avg edge, unread alerts), clickable top PLAY props (opens PropDetailSheet), recent injuries with status colors, today's games with O/U
2. **Slate Board** — player picks table with watch/unwatch toggles, team picks tab (NEW badge), filters (sport/action/min edge), watched count badge, PropDetailSheet on row click
3. **Injuries & News** — injury cards with color-coded status (out/gtd/questionable/healthy), lineup confirmations with expected minutes
4. **Entry Builder** — global picks cart (add from Slate Board), Power/Flex playstyle toggle, real payout calculator, stake input, notes, LOG ENTRY button
5. **Journal** — expandable entry rows with P&L summary header, result badges (WIN/LOSS/PARTIAL/PENDING), early exit badge, emoji emotional state, AI Entry Analysis (SSE), Log Entry modal
6. **Review Dashboard** — bankroll curve chart, Total P&L / Entry Hit Rate / Pick Hit Rate / Avg CLV KPIs, hit rate breakdown by pick count and entry type
7. **AI Analyst** — multi-turn Claude chat, conversation sidebar with history, delete, new conversation
8. **Settings & Data Health** — individual sync buttons per provider, Sync All button, live sync logs with status/records/timestamps, system info

## Payout Multipliers

- Power: 2=3×, 3=6×, 4=10×, 5=20×, 6=40×
- Flex: 3/3=5×, 2/3=1.25×, 4/4=10×, 3/4=2.5×, 5/5=20×, 4/5=4×, 3/5=1×, 6/6=40×, 5/6=6×, 4/6=1.5×

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after OpenAPI spec changes; never edit generated files directly.
- After schema changes: `pnpm --filter @workspace/db run push` then `pnpm --filter @workspace/scripts run seed`.
- Review stats API is at `/api/dashboard/review` — called via `useGetReviewStats`.
- `useGetDataHealth` takes a single `options?` arg.
- Do not call `createEntry.mutateAsync` with flat data — always wrap in `{ data: {...} }`.
- Port conflicts on restart: if EADDRINUSE, restart both workflows via the workflow manager.
- `WatchlistItemInput` requires `playerId` + `statType`, not `ppLineId`.
- `EntryInput` does not include `result` — set result via `EntryUpdate` (PATCH) after creation.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
