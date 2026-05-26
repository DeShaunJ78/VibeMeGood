# Variance Intelligence Signals

## Signal Types and Their Impact

### Fatigue & Rest (Validated Signal)
- Back-to-back game: +35 fatigue points → score ≥ 35 → −3% EV modifier
- 3 games in 4 nights: +20 fatigue points
- Travel > 2000 miles: +15 fatigue points
- Timezone shift ≥ 3 hours: +10 fatigue points
- Heavy minutes (≥ 40 min last game): +10 fatigue points
- Overtime last game: +8 additional points
- Early game (before noon): +5 points
- Well rested (4+ days): −10 points

Thresholds:
- Score ≥ 60: Heavy fatigue → −6% EV modifier
- Score 40–59: Moderate fatigue → −3% EV modifier
- Score ≤ −5: Well rested → +2% EV modifier

### Game Environment (Validated Signal)
Blowout risk based on point spread:
| Sport | Moderate | Heavy (−6% EV) | Extreme (−10% EV) |
|---|---|---|---|
| NBA | 9+ pts | 14+ pts | 18+ pts |
| NFL | 10+ pts | 14+ pts | 17+ pts |
| MLB | 2.5+ runs | 3.5+ runs | 5+ runs |
| NHL | 1.5 goals | 2 goals | 2.5 goals |

### Role & Usage Trends (Validated Signal)
Compares last 5 games vs season average (minutes):
- +15% usage spike → usageScore 90, +6% EV modifier
- +8% usage spike → usageScore 72, +3% EV modifier
- −8% usage drop → usageScore 28, −2% EV modifier
- −15% usage drop → usageScore 15, −5% EV modifier

### Matchup Depth (Validated Signal)
Historical over rate vs this specific opponent (requires 3+ games).
Score 0–100 where 70+ = strong historical edge.

## EV Modifier Rules
- Hard cap: ±15% regardless of signal combination
- Narrative signals: display-only, NEVER contribute to EV modifier
- Experimental signals: display-only, NEVER contribute to EV modifier
- Aggressive Mode: doubles all signal weights (still capped at ±15%)

## Narrative Signals (Display Only)
These appear in the "Why This Edge Exists" panel but never change EV:
- Revenge game narrative
- National TV game
- Playoff implications

## Experimental Lab Signals
Zero statistical validity — for curiosity only:
- Birthday game tracker
- New shoes signal
- Haircut game log
- Social media spike score
