---
name: Distribution engine roadmap
description: Replacing normal distribution with stat-appropriate distributions. Stages 1–3 complete + routing gap fixes + NBA NegBin pass. All changes isolated to distributions.ts.
---

## Architecture
Single swap point: `distributions.ts`. Consumers call `pOverLineDist(mean, sigma, line, statType)`.
`DistributionFamily = "normal" | "poisson" | "negbin" | "zip" | "lognormal"`

## Measured progression (walk-forward backtest, n=36,881)

| Milestone | Brier | CHR | ECE | MaxCalErr |
|-----------|-------|-----|-----|-----------|
| All Normal (Stage 0) | ~0.28+ | ~50% | — | — |
| Stage 1 Poisson | 0.2626 | 55.6% | — | — |
| Stage 2 NegBin | 0.2354 | 66.6% | — | — |
| Stage 3 ZIP | 0.2286 | 69.6% | 7.8% | 39.9% |
| +Routing gap fixes | 0.2118 | 73.9% | 3.1% | 16.0% |
| +homeAway removed | ~0.2118 | ~73.9% | ~3.1% | ~16.0% |
| **+Turnovers NegBin** | 0.2106 | 74.6% | 2.5% | 16.0% |
| **+Rebounds NegBin** | **0.2099** | **74.9%** | **2.0%** | **16.0%** |

## Current routing table

### Poisson
Home Runs, Goals, Pass/Rush/Rec TDs, 3-PT Made, Triples

### Negative Binomial (r = mean²/(sigma²−mean), Poisson fallback if underdispersed)
RBIs, Hits, Walks, Assists (NHL+NBA), Doubles, Runs, Singles, Total Bases, Steals (NBA),
Hitter Strikeouts, **Turnovers**, **Rebounds**

### Zero-Inflated Poisson (hardcoded p_zero)
Stolen Bases (π=0.15), Power Play Points (π=0.20), Blocked Shots (π=0.10)

### Log-normal (Stage 4, STAGE4_LOGNORMAL_ENABLED flag)
Pass Yards, Rush Yards, Receiving Yards — **behind flag; no yardage data in game logs; flag neutral**

### Normal (everything else)
Points, combination stats (Pts+Rebs+Asts, Rebs+Asts, etc.), Hits+Runs+RBIs

## Per-stat isolated NegBin effects

| Stat | Brier before | Brier after | ECE before | ECE after | CHR before | CHR after |
|------|-------------|-------------|-----------|-----------|-----------|-----------|
| Turnovers | 0.2601 | **0.2327** | 16.2% | 0.98% | 52.1% | 67.3% |
| Rebounds | 0.2590 | **0.2447** | 11.5% | 1.55% | 48.4% | 63.6% |
| Assists | 0.2525 | 0.2525 | 5.7% | 5.7% | — | — |

Assists was already on NegBin (Stage 2 added it for NHL; NBA shares same stat-type string). Its 37.4% MaxCalError is the current ceiling for that stat — not a routing problem.

## homeAway factor — RETIRED
Removed from compute.ts and backtest-engine.ts. Function preserved in factors.ts but not called.
Three independent tests all returned negative delta. Data voted three times.

## Blocked Shots MaxCalError 90.5% — INVESTIGATED, NOT A PROBLEM
Bucket 0-10%: **n=1** (one prediction). By chance that prediction was wrong.
Buckets with real data (10-50%, n=155-592) all have gaps < 3.5%. ZIP is well-calibrated.

## Remaining high-Brier stats (current ceiling)
- Hits+Runs+RBIs: 0.2723 — composite/correlated; second-order complexity
- Assists: 0.2525 — NegBin ceiling; genuinely harder to predict
- Combination stats (Rebs+Asts, Pts+Asts, etc.): 0.2473–0.2504 — same as above
- Points: 0.2482 — Normal; possible NegBin candidate but smaller expected gain

## NBA sport-level progress
| | Before any routing | After full pass |
|---|---|---|
| Brier | 0.2433 | **0.2395** |
| CHR | 63.7% | **66.9%** |
| ECE | 4.3% | **2.05%** |

## Next instrument: Tier 5 — Recommendation ROI
The model ECE < 2% means probabilities can be trusted in edge calculations.
Data already captured: `entry_picks.projectedEdge` → `entry_picks.result`.
Tier 5 = stake-weighted ROI per edge bucket (0-5%, 5-10%, 10-15%, 15-20%, 20%+).
One-query join from Journal entries to Audit infrastructure.

## Stage 4 status
Log-normal for Pass/Rush/Receiving Yards. Behind STAGE4_LOGNORMAL_ENABLED flag.
No yards data in game logs — flag fires zero times. Stage 4 neither proven nor disproven.

## Calibration workflow
After any routing change: TRUNCATE probability_calibration → `pnpm calibrate`.
Backtest audit: POST /api/audit/run (30-60s) → GET /api/audit/latest → Audit Dashboard.
