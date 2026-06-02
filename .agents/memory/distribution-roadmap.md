---
name: Distribution engine roadmap
description: Strategic decision to replace normal distribution with stat-appropriate distributions (Poisson/NegBin/ZIP) for sparse counting stats. Stage 1 and Stage 2 complete.
---

## Decision
Replace normal distribution pOver calculation with stat-appropriate distributions. Architecture supports this cleanly — `pOverLineDist()` in `distributions.ts` is the single swap point; compute.ts, slate.ts, and backtest.ts all route through it.

## Why
Calibration audit showed consistent directional bias: overs over-predicted ~10–15% across all buckets, unders under-predicted ~7–9%. Mathematical signature of distribution misspecification (right-skewed counting stats forced into symmetric normal), not data error or sampling noise.

## Implementation architecture
- `distributions.ts` — single file for all CDF math and routing. Only file that changes per stage.
- `DistributionFamily = "normal" | "poisson" | "negbin"` (add "zip" for Stage 3)
- NegBin dispersion r = mean²/(sigma²−mean), computed dynamically at runtime from blended (mean, sigma). Auto-falls back to Poisson when sigma²≤mean (underdispersed per blended estimate).
- Calibration layer stays on top unchanged.

## Rollout — measured results

### Stage 1 (complete): Poisson
Stats: Home Runs, Goals, Pass/Rush/Rec TDs, Stolen Bases, 3-PT Made
- Home Runs under calibration gap: 9pp → 3pp (two-thirds reduction)
- Backtest Brier: 0.2626 → baseline after Stage 1

### Stage 2 (complete): Negative Binomial
Stats: RBIs, Hits, Walks, NHL Assists, Doubles, Runs, Singles
- Backtest Brier: 0.2626 → **0.2354** (−0.0272)
- Confident hit rate: 55.6% → **66.6%** (+11pp)
- Key driver: RBIs at line=1.5 shifted from Normal 89.6% → NegBin 16.2%

**Fallback behavior observed:** Hits and NHL Assists with prior std produce sigma²<mean → auto-fall to Poisson. Will express true NegBin behavior once real game-log stds blend in (r computed from sample, not prior).

### Stage 3 (next): Zero-Inflated Poisson
Stats: Power Play Points, Blocked Shots
- Structural zero excess — player often has true "not in role today" game state
- Stolen Bases residual (92.9% actual vs 83% Poisson) also a ZIP candidate
- Need p_zero per player+stat (estimated from fraction of zero-games in sample)

### Stage 4 (future): Yards stats
Pass Yards, Rush Yards, Receiving Yards — continuous-ish, hard floor > 0 for active players. Log-normal or NegBin with large r.

## Expected edge implications
Sparse-stat UNDERS are the platform's strongest edges:
1. Model now better-calibrated for under probability
2. Human bettors gravitate toward overs (survivorship/highlight bias)
3. Books/DFS operators least sharp on rare-event unders
