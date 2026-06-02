---
name: Factor engine & walk-forward backtest
description: Design rules for the projection factor engine and where the backtest lives / why.
---

# Projection factor engine + backtest

## No-default-side / no-fake-signal rule
A context factor must return null (not a defaulted value) when its required context
is missing. Specifically: the implied-team-total factor requires a KNOWN home/away
side — never assume `isHome ?? true`. Assuming a side fabricates a directional signal
and systematically biases projections.
**Why:** the whole engine's value proposition is "transparent, no silent no-ops, no
fake data." A defaulted side looks like a real signal in the UI breakdown but isn't.
**How to apply:** any new factor that needs side/opponent/odds/weather context must
guard on that context being non-null before pushing the FactorResult.

## Backtest harness location
The walk-forward backtest lives in `artifacts/api-server/src/scripts/backtest.ts`
(run via `pnpm --filter @workspace/api-server run backtest`), NOT in the `scripts`
package.
**Why:** the backtest must reuse the real factor engine (`factors.ts`) and
`normal-dist` as the single source of truth. Leaf workspace packages can't import
each other, and `@workspace/scripts` is a leaf — so it cannot import the engine that
lives inside the api-server artifact. Putting the backtest in api-server lets it
import them via relative paths. Required adding `tsx` as an api-server devDependency.

## Backtest honesty constraints
- Per-factor "marginal lift" must apply ONE factor at a time (isolated counterfactual),
  never attribute the combined product to each factor — otherwise multi-factor rows
  double-credit the joint effect.
- Only factors derivable purely from historical game logs (rest/B2B, home/away) are
  evaluated. Pace/DvP/implied-total/weather/NFL-advanced need external context not on
  historical logs; report them as "not evaluable" rather than synthesizing inputs.
- home/away shows 0 rows in the backtest until `player_game_logs.home_away` is
  populated going forward (capture added in backfill, not backfilled historically).
