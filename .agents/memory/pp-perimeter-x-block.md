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

**PP cron:** Every 30 min (`*/30 * * * *`) — reduced from 10 min; server syncs will always fail without PerimeterX bypass but circuit breaker (3 fails → 30 min backoff) prevents alert spam.

**How to apply:** Don't attempt to fix server-side PP sync with proxies or headers alone. Browser sync is the correct long-term approach. If full automation is needed, Puppeteer with stealth plugin is the only option (not implemented).
