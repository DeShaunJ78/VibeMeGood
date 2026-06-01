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
- Frontend fetches PP directly from the user's real browser (home IP, real JS runtime — PX passes it)
- Raw JSON is POSTed to the server for processing via `processPpData()`
- Settings page has an amber "Sync PP Now" button that runs the full flow
- Sidebar shows a pulsing red dot + "Xh stale" badge on the Settings item when PP lines are > 4 hours old (threshold: `PP_STALE_HOURS = 4`)

**Proxy support exists but is insufficient:**
- `PP_PROXY_URL` env var accepts comma-separated `host:port:user:pass` or `http://user:pass@host:port` entries
- Uses `undici`'s `ProxyAgent` + `undiciFetch` (must use same undici instance — mixing with Node's built-in fetch causes `invalid onRequestStart method` error)
- Proxy gets through to PP but PerimeterX CAPTCHA fires anyway

**No automatic PP cron — by design.** There is intentionally NO scheduled/server-side PP sync, and PP is excluded from the `/sync/all` and `/sync/pre-lock` batches and from the frontend `SYNC_JOBS` list. Earlier there was a 30-min cron with a circuit breaker; it was removed because every tick 403s and overwrites the import's success in `data_pull_logs`, flipping the Settings data-health dot back to red ~30 min after each import. The data-health dot reads the *latest* log per provider, so any doomed server pull poisons it. The browser copy-paste import is the ONLY thing that should ever write a `provider='prizepicks'` log.

**Why:** user repeatedly saw the PP status go red on its own; root cause was the doomed cron, not the import.

**How to apply:** Never re-add a server-side PP fetch to cron or to any "sync all"/"pre-lock"/per-provider button. PP lines come only from the paste import. If full automation is ever needed, Puppeteer with a stealth plugin is the only option (not implemented). After a republish, the dot stays red until the user does one fresh import (no cron error left to overwrite it).
