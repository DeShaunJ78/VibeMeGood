---
name: Self-executing scripts in the bundled API server
description: Why a self-running script block crashes the server on startup, and the fix.
---

The api-server is bundled by esbuild into a single `dist/index.mjs`. Any module
the server imports (e.g. via cron.ts) gets inlined into that bundle.

**Rule:** a module imported by the server must NOT contain a top-level
self-executing block guarded by an `isMain` check like
`import.meta.url === \`file://${process.argv[1]}\``.

**Why:** in the bundle, `import.meta.url` and `process.argv[1]` both resolve to
the server entry, so the guard is TRUE at server startup. The job runs on boot
and its `process.exit(0)` terminates the server (workflow shows FINISHED, health
checks fail, async work never completes).

**How to apply:** keep the runnable logic in an importable module with NO
self-exec, and put the `runX().then(()=>process.exit(0))` runner in a separate
entry file that ONLY the npm script invokes via tsx (never imported by server
code). See `run-calibration.ts` vs `calibration-job.ts`.
