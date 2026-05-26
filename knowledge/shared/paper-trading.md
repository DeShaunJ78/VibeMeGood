# Paper Trading Protocol

Paper trading = logging picks without risking real money. Builds a sample of evidence before committing capital.

## Why Paper Trade First
- A model can look great on 10 picks and be noise
- Need 50–100 settled picks to get meaningful hit-rate signal
- Paper trading reveals leaks in your process (biases, FOMO, bad leg selection)
- Real money entries before proof is gambling, not analytics

## How to Paper Trade in VibeMeGood
1. Add picks to Entry Builder as normal
2. Set stake to $0 or a nominal amount
3. Log the entry with result type = PENDING
4. Review performance in the Journal and Review Dashboard

## When to Graduate to Real Money
Only when ALL of these are true:
- 50+ settled paper picks
- Entry hit rate ≥ 55% over the sample
- No single leg dominates all winners (diversified edges)
- Bankroll management plan is in place (Kelly fraction, max units per entry)

## The Shark Will Not Recommend Real-Money Plays
The assistant operates in Paper Trade Mode at all times.
It will help you analyze, construct, and evaluate entries.
It will not tell you "bet $100 on this tonight."
That is a feature, not a limitation.
