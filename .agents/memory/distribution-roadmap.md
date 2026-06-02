---
name: Distribution engine roadmap
description: Replacing normal distribution with stat-appropriate distributions. Stage 1–3 complete. All changes isolated to distributions.ts.
---

## Architecture
Single swap point: `distributions.ts`. Consumers (`compute.ts`, `slate.ts`, `backtest.ts`) call `pOverLineDist(mean, sigma, line, statType)` — no changes needed when adding new distributions.

`DistributionFamily = "normal" | "poisson" | "negbin" | "zip"` — add "lognormal" for Stage 4.

## Measured progression

| Stage | Description | Brier | Confident HR | Δ Brier | Δ HR |
|-------|-------------|-------|-------------|---------|------|
| 0 | All Normal | ~0.28+ | ~50% | — | — |
| 1 | + Poisson | 0.2626 | 55.6% | −0.02+ | +5pp |
| 2 | + NegBin | 0.2354 | 66.6% | −0.0272 | +11pp |
| 3 | + ZIP | **0.2286** | **69.6%** | −0.0068 | +3pp |

**Key driver of Stage 2 (−0.0272):** RBIs at line=1.5 shifted Normal 89.6% → NegBin 16.2%.
**Key drivers of Stage 3 (−0.0068):** PPP and Blocked Shots moved from Normal (wildly wrong) to ZIP.

## Stage 1 — Poisson
Stats: Home Runs, Goals, Pass/Rush/Rec TDs, 3-PT Made
Home Runs under gap: 9pp → 3pp.

## Stage 2 — Negative Binomial
Stats: RBIs, Hits, Walks, NHL Assists, Doubles, Runs, Singles
r = mean²/(sigma²−mean), dynamic. Falls back to Poisson when sigma²≤mean.
Note: Hits and NHL Assists often fall back to Poisson because prior std is conservative.

## Stage 3 — Zero-Inflated Poisson
Stats: Stolen Bases (π=0.15), Power Play Points (π=0.20), Blocked Shots (π=0.10)
Stolen Bases MOVED from Poisson set to ZIP set.
λ_eff = mean/(1−π) preserves E[X]=mean.
CDF: P(X≤k) = π + (1−π)·PoissonCDF(λ_eff, k)

**ZIP p_zero tuning note:** ZIP vs Poisson delta for SB is tiny (~0.3pp) because mean=0.18 is very low.
The real SB residual (92.9% actual vs 83% model) likely reflects prior mean being too high
for PP-eligible SB players — the actual eligible population mean is closer to 0.07–0.10.
Future fix: lower SB prior mean or compute per-player ZIP pZero from game-log zero fraction.

## Stage 4 (future)
Pass Yards, Rush Yards, Receiving Yards — continuous with hard floor > 0 for active players.
Log-normal or NegBin with large r.

## Calibration pattern after Stage 3
- 0-10%: pred 5.9%, actual 6.9% (n=1004) — nearly perfect
- 10-20%: pred 16.5%, actual 16.5% (n=4248) — PERFECT
- 20-30%: pred 25.3%, actual 24.4% (n=3086) — near-perfect
- 30-40%: 33.0% actual vs 35.8% pred — 2.8pp residual
- 50%+ range: systematic over-prediction remains (calibration layer handles this)

## Edge implications
Sparse-stat UNDERS are the platform's strongest signals. The under probability is now well-calibrated
for Home Runs, Power Play Points, and Blocked Shots. Stolen Bases under still has a ~9pp residual
(prior mean mismatch, not distribution mismatch — ZIP is the right model, needs better prior).
