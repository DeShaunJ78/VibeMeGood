# AGENTS.md

## Cursor Cloud specific instructions

### Product

**VibeMeGood** (PrizePicks Analytics Workstation): pnpm monorepo with Express API (`artifacts/api-server`), React/Vite SPA (`artifacts/prizepicks`), and shared packages under `lib/`. See `replit.md` for commands and architecture.

### Runtime prerequisites (VM-level, not in update script)

- **Node.js 24** via nvm (`nvm install 24`). The default `/exec-daemon/node` is v22; prepend `$HOME/.nvm/versions/node/v24.16.0/bin` to `PATH` before any `pnpm` command.
- **PostgreSQL 16** with a dev database (example: `postgresql://vibemegood:vibemegood@localhost:5432/vibemegood`).
- **nginx** on port **80** to mirror Replit routing: `/` → frontend (`24892`), `/api` → API (`8080`). The Vite dev server has **no** `/api` proxy; hitting the frontend port directly will break API calls.

Example nginx site config lives at `/tmp/nginx-vibemegood.conf` in a typical Cloud VM setup (copy into `/etc/nginx/sites-enabled/`).

### Environment variables

Required for API + DB tooling:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Required at import (use a placeholder for non-AI testing) |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | e.g. `https://api.anthropic.com` |
| `PORT` | API: `8080`; frontend dev: `24892` |
| `BASE_PATH` | Frontend dev: `/` |

Optional: `DATA_MODE=live`, `ODDS_API_KEY` (external odds sync).

### Starting dev services

Use **tmux** for long-running processes. Three pieces must be up:

1. API: `pnpm --filter @workspace/api-server run dev` (rebuilds on each start; does not hot-reload `app.ts` middleware changes — restart if CORS/proxy behavior looks wrong).
2. Frontend: `PORT=24892 BASE_PATH=/ pnpm --filter @workspace/prizepicks run dev`
3. nginx on port 80 (see above).

Health check: `curl http://127.0.0.1/api/healthz` → `{"status":"ok"}`.

### Database (first time or after schema changes)

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed
```

`scripts/post-merge.sh` runs `pnpm install` + `db push` only (no seed).

### pnpm build-script approval

pnpm 11 blocks `esbuild` postinstall until approved. On a fresh clone, run **`pnpm approve-builds --all`** once before `pnpm install` (also included in the VM update script). Without this, installs fail with `ERR_PNPM_IGNORED_BUILDS`.

### Lint / test / build

| Command | What it does |
|---------|----------------|
| `pnpm run typecheck` | Full TS check (libs + artifacts + scripts) |
| `pnpm run build` | typecheck + build all packages |
| `pnpm --filter @workspace/scripts run data-quality` | 48 DB integrity checks (Replit “Project” validation workflow) |

There is no ESLint config or unit test runner in the repo; `data-quality` is the main automated gate.

### Gotchas

- API `dev` script runs `build` then `node dist/index.mjs` each time — slower than Vite HMR.
- Slate Board defaults may filter to a sport with no seeded lines; use **All Sports** to see seed data.
- Real Anthropic keys are required for AI Analyst / Shark Chat / SSE explain routes; placeholder keys only satisfy boot.
