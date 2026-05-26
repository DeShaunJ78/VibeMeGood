# Calibration Tracking in VibeMeGood

## What Calibration Means
A model is "calibrated" when its probability estimates match reality.
If the model says 60% P(Over) on 100 props, ~60 of them should actually go over.
If 80 go over, the model is underconfident. If 40 go over, it's overconfident.

## Tracking in VibeMeGood
The Journal and Review Dashboard track:
- **Entry Hit Rate**: % of entries that result in WIN or PARTIAL
- **Pick Hit Rate**: % of individual legs that hit
- **Avg CLV** (Closing Line Value): how your projections compare to line movement

## Reading the Review Dashboard
- **Bankroll Curve**: should trend up over time with good process
- **Hit Rate by Pick Count**: reveals which entry sizes work best for your model
- **Entry Type Breakdown**: Power vs Flex performance

## Warning Signs
- Hit rate < 50% over 30+ picks: model needs recalibration or process has leaks
- High entry hit rate but low pick hit rate: getting lucky on flex entries
- Bankroll curve flat or declining despite "good picks": check stake sizing
- All wins concentrated in one player/stat type: concentration risk

## Calibration Process
1. Run 50+ paper picks before adjusting real weights
2. Compare P(Over) buckets (50–55%, 55–60%, 60%+) to actual over rates
3. If systematically off, adjust `hitRateAssumptions` in Settings
4. Re-run 30+ picks after adjustment to measure impact
