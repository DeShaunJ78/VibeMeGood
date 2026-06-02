---
name: Distribution engine roadmap
description: Replacing normal distribution with stat-appropriate distributions. Stages 1–3 complete + routing gap fixes. All changes isolated to distributions.ts.
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
| +Routing gap fixes | **0.2118** | **73.9%** | **3.1%** | **16.0%** |

Routing gap fixes: Triples→Poisson, Total Bases / Steals (NBA) / Hitter Strikeouts→NegBin.
homeAway generic edge zeroed (empirically net-negative twice). Factor now evidence-only.

## Current routing table

### Poisson
Home Runs, Goals, Pass/Rush/Rec TDs, 3-PT Made, **Triples**

### Negative Binomial (r = mean²/(sigma²−mean), Poisson fallback if underdispersed)
RBIs, Hits, Walks, NHL Assists, Doubles, Runs, Singles, **Total Bases**, **Steals (NBA)**, **Hitter Strikeouts**

### Zero-Inflated Poisson (hardcoded p_zero)
Stolen Bases (π=0.15), Power Play Points (π=0.20), Blocked Shots (π=0.10)

### Log-normal (Stage 4, STAGE4_LOGNORMAL_ENABLED flag)
Pass Yards, Rush Yards, Receiving Yards — **behind flag; no yardage data in game logs yet; flag neutral**

### Normal (everything else)
Points, Rebounds, Assists (NBA), Turnovers, combination stats (Pts+Rebs+Asts, etc.)

## Key stats from the routing gap fix run

**Best calibrated (low Brier = distribution working correctly):**
- Triples: Brier 0.0126, ECE 0.0%, CHR 98.7% ← Poisson crushed it (rarest hit type)
- Stolen Bases: Brier 0.0663, ECE 1.1%, CHR 92.9%
- Runs: Brier 0.1601, ECE 1.8%
- Home Runs: Brier 0.1599, ECE 1.5%
- Hitter Strikeouts: Brier 0.1635 (was 0.2322 with Normal)
- Doubles: Brier 0.1662

**Remaining high-Brier stats (Normal routing):**
- Hits+Runs+RBIs: 0.2723 — combination stat, fundamentally harder
- Turnovers: 0.2601 — NBA, routing Normal; possible NegBin candidate
- Rebounds: 0.2590 — NBA, routing Normal
- Assists (NBA): 0.2525 — different from NHL Assists (already NegBin)
- Combination stats (Rebs+Asts, Pts+Asts, etc.): 0.2473–0.2504

**One flag: Blocked Shots MaxCalError 90.5%** — ECE only 3.2% so overall calibration fine,
but one specific bucket has ~90pp gap. Likely sparse ZIP bucket. Investigate before trusting
high-edge Blocked Shots predictions.

## homeAway factor audit result
- Generic edge (0.01/-0.01) was always firing on isHome — pure assumption, net-negative
- Zeroed generic: `genericHome: 0.0, genericAway: 0.0`
- Factor now fires ONLY when both homeAvg AND awayAvg exist from game logs
- Split-based homeAway STILL shows −0.0004 delta after zeroing generic
- Verdict: historical home/away split signal is also not helpful in this dataset
- Next option: require N≥5 home AND N≥5 away games before applying, or remove entirely

## Stage 4 status
Log-normal for Pass/Rush/Receiving Yards. Behind STAGE4_LOGNORMAL_ENABLED flag.
No yards data in game logs — flag fires zero times. Stage 4 neither proven nor disproven.
Do not permanently merge until yards data exists and Brier+ECE beat current baseline.

## Calibration notes
- TRUNCATE probability_calibration before re-running calibrate after any distribution change
- calibration-job.ts uses pOverLineDist (fixed) — was incorrectly using pOverLine (Normal) before
- After routing gap fixes: 166 calibration records, MAE 0.4165
