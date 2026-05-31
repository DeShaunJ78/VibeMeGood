---
name: Scoring PLAY thresholds
description: Why PLAY thresholds were lowered from 75/60 to 70/55 for overallScore/edgeScore
---

# PLAY Action Tag Thresholds

**Rule:** `overallScore >= 70 && edgeScore >= 55 && riskScore <= 45`

Original values were `>= 75` and `>= 60`.

**Why:** The edgeScore formula is `(pOver-50)*2*0.6 + marketEdge*150*0.4`. The pOver component maxes at `(100-50)*2*0.6 = 60`. Without multi-book market data (marketEdge ≈ 0), edgeScore can never exceed 60 — it literally reaches the threshold only at pOver=100%. Lowering to 55 lets pOver≥96% props qualify. Similarly overallScore is dragged down by marketSupportScore defaulting to 50 when no book data exists, pushing finalScore to ~72 even with very high pOver.

**How to apply:** If thresholds are ever re-tuned, remember the pOver ceiling of 60 without market data. Any PLAY edge threshold above 60 will produce zero PLAY props unless market data is present.
