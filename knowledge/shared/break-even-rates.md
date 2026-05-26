# Break-Even Rates by Entry Type

PrizePicks pick'em break-even rates — the minimum per-leg win probability needed for positive EV.

| Entry Type | Multiplier | Break-Even Per Leg |
|---|---|---|
| 2-pick Power | 3× | 57.7% |
| 3-pick Power | 6× | 55.0% |
| 4-pick Power | 10× | 56.2% |
| 5-pick Power | 12× | 57.4% |
| 5-pick Flex | 8× | 52.8% |
| 6-pick Power | 25× | 57.4% |
| 6-pick Flex | 15× | 51.9% |

Formula: break-even = (1 / multiplier)^(1/n) where n = pick count.

Key insight: For 5- and 6-leg entries, Flex always has a lower break-even than Power, making it the optimal structure when you have 5+ legs.

## EV Formula
EV = (∏ probabilities) × multiplier − 1

Example: 2-pick at 60%/60% with 3× = 0.60 × 0.60 × 3 − 1 = 0.08 = +8% EV ✅
Example: 2-pick at 50%/50% with 3× = 0.50 × 0.50 × 3 − 1 = −0.25 = −25% EV ❌

## Optimal Structure by Leg Count
- 2 legs → 2-pick Power (BE: 57.7%)
- 3 legs → 3-pick Power (BE: 55.0%)
- 4 legs → 4-pick Power (BE: 56.2%)
- 5 legs → 5-pick Flex (BE: 52.8%) ← lower than 5-pick Power
- 6 legs → 6-pick Flex (BE: 51.9%) ← significantly lower than 6-pick Power
