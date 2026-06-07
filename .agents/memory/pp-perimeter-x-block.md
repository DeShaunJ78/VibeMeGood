---
name: PrizePicks PerimeterX block
description: Why server-side PP syncs fail and what the working solutions are
---

PrizePicks API (`api.prizepicks.com/projections`) is protected by **PerimeterX** bot detection (`appId: PXZNeitfzP`). All server-side fetch attempts from cloud IPs (Replit/AWS/GCP) return a 403 with a JS CAPTCHA challenge page, not JSON — regardless of User-Agent or headers.

## Residential proxy situation

`PP_PROXY_URL` is set as a secret. It is a **comma-separated list of 20 entries** in `ip:port:user:pass` format (no http:// prefix, ~846 chars total). Each entry must be parsed manually: split on `,`, trim, split on `:` → 4 parts → build `http://ip:port` URI + `Basic base64(user:pass)` token for undici ProxyAgent.

**However:** a raw TCP CONNECT test confirmed the proxies return **407 Proxy Authentication Required** from Replit's cloud IPs even when the `Proxy-Authorization: Basic ...` header is sent correctly. This indicates the proxy pool uses **IP whitelisting** (only the user's registered home IP is authorized) rather than pure username/password auth from any IP. These proxies work from the user's home machine but not from Replit's datacenter IPs.

**The server-side `/api/sync/pp-lines-fetch` route exists** (sync.ts, uses undici ProxyAgent with `token` option), but it will always fail with 407 while Replit's outbound IP is not whitelisted with the proxy provider.

**Possible fixes (if server-side sync is desired):**
1. Ask the proxy provider to add Replit's outbound IPs to the whitelist, OR
2. Switch to a proxy plan that uses pure user/pass auth from any IP (no IP restriction), OR
3. Accept that server-side fetch won't work and keep the browser-import path.

## Working solution: Browser-import

`POST /api/sync/pp-lines-import` — the browser fetches PP (home IP, real JS runtime — PX passes), raw JSON is POSTed to the server and processed via `processPpData()`.

**Two front-ends:**
1. One-click bookmarklet: user drags "PP → Workstation" to bookmarks bar, clicks it while on a logged-in `*.prizepicks.com` tab — fetches feed same-site (cookies + PX pass) and POSTs to import URL.
2. Manual copy-paste textarea fallback.

Both live in Settings → Data Sync (the PrizePicks row).

**Bookmarklet details:**
- Posts **cross-origin**, so server CORS allowlist must include `*.prizepicks.com`.
- Build the href as a string and set via `el.setAttribute('href', …)` — React sanitizes `javascript:` hrefs otherwise.
- `window.location.origin` baked into bookmarklet at render time → set it up from the **deployed** app for a durable URL.

## No PP cron — by design

No scheduled server-side PP sync. PP is excluded from `/sync/all`, `/sync/pre-lock`, and the frontend `SYNC_JOBS` list. A cron would 403 every tick and poison the `data_pull_logs` latest-entry for the PP row in Settings data-health, flipping the dot red 30 min after every import.

**Why:** user repeatedly saw the PP status go red on its own; root cause was the doomed cron.

**How to apply:** Never re-add a server-side PP fetch to cron or to any "sync all"/"pre-lock"/per-provider button. PP lines come only from the browser import. If full automation is ever needed, Puppeteer with a stealth plugin is the only option (not implemented). After a republish, the dot stays red until the user does one fresh import.

## undici ProxyAgent notes (Node 24)

- Node 24's global `fetch` uses a different internal undici build than the installed `undici` package. Passing an `undici@8.x` `ProxyAgent` to the global `fetch` throws `"invalid onRequestStart method"`.
- **Fix:** use `undiciFetch` from the installed undici package: `const { fetch: undiciFetch, ProxyAgent } = await import("undici")`.
- Pass proxy auth via `new ProxyAgent({ uri: 'http://ip:port', token: 'Basic base64...' })` — embedding credentials in the URI produces 407 in some proxy configs.
