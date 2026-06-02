---
name: Distribution engine roadmap
description: Strategic decision to replace normal distribution with stat-appropriate distributions (Poisson/NegBin/ZIP) for sparse counting stats. Incremental rollout plan agreed.
---

## Decision
Replace normal distribution pOver calculation with stat-appropriate distributions. Architecture supports this cleanly — `pOverLine()` in `compute.ts` is the single swap point.

## Why
Calibration audit shows consistent directional bias: overs over-predicted ~10–15% across all buckets, unders under-predicted ~7–9%. This is a mathematical signature of distribution misspecification (right-skewed counting stats forced into symmetric normal), not data error or sampling noise.

**Strongest signal:** 25+ Under bucket — 408,977 samples, model predicts 80%, actual rate 88.5%. Indicates model under-estimates how often sparse stats go under.

## Rollout plan (incremental — measure ECE/Brier between stages)
- **Stage 1:** Home Runs, Goals, TDs → Poisson (low mean 0.1–0.8, floor=0)
- **Stage 2:** RBIs, Hits, Walks, Assists → Negative Binomial (overdispersed)
- **Stage 3:** PPP, Blocked Shots → Zero-Inflated Poisson (mostly 0, occasional 1–3)
- **Stage 4:** Pass/Rush/Rec Yards → Log-normal or NB (continuous-ish, hard floor)

## Architecture notes
- `pOverLine()` in `compute.ts` is the swap point. Route by stat_type → distribution family
- Priors need a `distributionFamily` field alongside mean/std
- NegBin needs a dispersion parameter `k`; ZIP needs `p_zero` — prior catalog doubles in complexity
- Calibration layer stays on top unchanged
- Expected ECE improvement: ~3–5 points (9.34% → 4–6%) for sparse stats

## Expected edge implications
Sparse-stat UNDERS likely become the platform's strongest edges because:
1. Model currently under-estimates under probability
2. Human bettors naturally gravitate toward overs (survivorship/highlight bias)
3. This is where books and DFS operators are least sharp
