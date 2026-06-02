---
name: PrizePicks PerimeterX block
description: Why server-side PP syncs always 403 and what the working solution is
---

PrizePicks API (`api.prizepicks.com/projections`) is protected by **PerimeterX** bot detection (`appId: PXZNeitfzP`). All server-side fetch attempts from cloud IPs (Replit/AWS/GCP) return a 403 with a JS CAPTCHA challenge page, not JSON — regardless of User-Agent, headers, or residential proxy.

**Why:**
- PP's Cloudflare WAF blocks datacenter ASNs at the IP level
- Residential proxies route the request correctly but PerimeterX still serves a CAPTCHA challenge that requires a real browser JS runtime to solve
- Headless Chrome (Puppeteer) is detectable by PX and would require ongoing evasion work

**Working solution:** Browser-import endpoint (`POST /api/sync/pp-lines-import`).
- The user's real browser fetches PP (home IP, real JS runtime — PX passes it); raw JSON is POSTed to the server and processed via `processPpData()`.
- Two front-ends to the same endpoint: (1) a **one-click bookmarklet** ("PP → Workstation") the user drags to their bookmarks bar and clicks while on a logged-in `*.prizepicks.com` tab — it `fetch`es the feed same-site (cookies + PX pass) and POSTs straight to the import URL; (2) a manual copy-paste textarea fallback. Both live behind a "PrizePicks Lines" sync row in Settings → Data Sync (badge "BROWSER"), co-located with the other sync buttons.
- The bookmarklet POSTs **cross-origin** (prizepicks.com → our domain), so the server CORS allowlist MUST include `*.prizepicks.com` (alongside `*.replit.app`/`*.replit.dev`/localhost + `REPLIT_DOMAINS`). The SPA itself is same-origin and needs no CORS.
- Build the bookmarklet href as a string and set it via a ref callback (`el.setAttribute('href', …)`) — React sanitizes `javascript:` hrefs otherwise, breaking drag-to-bookmark.
- `window.location.origin` is baked into the bookmarklet at render time, so set the bookmark up from the **deployed** app (not the dev preview) for a durable URL.
- Sidebar shows a pulsing red dot + "Xh stale" badge on the Settings item when PP lines are > 4 hours old (threshold: `PP_STALE_HOURS = 4`).

**Security posture:** the whole API is unauthenticated (private single-user tool). The import route is an open mutating endpoint; mitigations are the CORS allowlist (blocks cross-origin writes from random sites the user visits — JSON POSTs trigger a preflight that fails for disallowed origins) + a payload item cap. App-level auth is the only real fix and is a deliberate not-yet-done product decision.

**Residential proxies do NOT defeat PerimeterX — never reach for them.** A proxied server fetch was tried and abandoned: the proxy reaches PP but PX still serves a CAPTCHA, so no JSON comes back. The entire server-side PP fetch path (proxy agents, `syncPpLines`/`fetchPP`, the `/sync/pp-lines` route + OpenAPI op, the `PP_PROXY_URL` secret) has been deleted. Browser import is the only ingestion path. If full automation is ever required, Puppeteer + stealth is the only viable route — not proxies.

**No automatic PP cron — by design.** There is intentionally NO scheduled/server-side PP sync, and PP is excluded from the `/sync/all` and `/sync/pre-lock` batches and from the frontend `SYNC_JOBS` list. Earlier there was a 30-min cron with a circuit breaker; it was removed because every tick 403s and overwrites the import's success in `data_pull_logs`, flipping the Settings data-health dot back to red ~30 min after each import. The data-health dot reads the *latest* log per provider, so any doomed server pull poisons it. The browser copy-paste import is the ONLY thing that should ever write a `provider='prizepicks'` log.

**Why:** user repeatedly saw the PP status go red on its own; root cause was the doomed cron, not the import.

**How to apply:** Never re-add a server-side PP fetch to cron or to any "sync all"/"pre-lock"/per-provider button. PP lines come only from the paste import. If full automation is ever needed, Puppeteer with a stealth plugin is the only option (not implemented). After a republish, the dot stays red until the user does one fresh import (no cron error left to overwrite it).
