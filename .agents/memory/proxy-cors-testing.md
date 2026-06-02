---
name: Proxy injects wildcard CORS in dev
description: Why you can't validate an artifact's own CORS through localhost:80, and how to test it.
---

The shared reverse proxy (`localhost:80`, and the dev preview domain) **injects its
own `Access-Control-Allow-Origin: *`** onto responses and answers `OPTIONS`
preflights itself. So curling an endpoint through the proxy always shows permissive
CORS regardless of what the app actually does.

**How to apply:** To verify an artifact service's *own* CORS allowlist, curl the
service's own `localPort` directly (e.g. `localhost:8080/...` from
`artifact.toml`), bypassing the proxy. There you'll see the app's real behavior:
an allowed origin is reflected back, a disallowed origin gets **no**
`Access-Control-Allow-Origin` header.

**Also:** dev servers run under a watcher but do not always hot-reload changes to
top-level server bootstrap files (e.g. `app.ts` middleware). If a CORS/middleware
change isn't taking effect, restart the workflow before concluding the code is
wrong — a stale `app.use(cors())` returning `*` looks identical to the proxy's `*`.
