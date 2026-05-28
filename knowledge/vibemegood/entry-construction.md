# Entry Construction in VibeMeGood

## The Pick'em Math Panel
The Entry Builder shows a real-time math panel when 2+ picks are added:
- **Entry type** — auto-selects based on pick count and playstyle
- **Multiplier** — exact payout multiplier for the entry type
- **Break-even per leg** — minimum win rate needed for positive EV
- **EV indicator** — Green (>5%), Amber (≈0%, near break-even), Red (<-0.5%)
- **Recommendation** — suggests optimal entry structure (e.g., "5-pick Flex is optimal")
- **Payout shift warning** — fires when correlated legs detected (same-team receivers, QB+WR stacks)

## Payout Shift Detection
VibeMeGood detects three correlation patterns:
1. **Two receivers same team, both over receiving yards** → ~8% multiplier reduction
2. **QB passing yards + WR receiving yards, same team, both over** → ~9% reduction
3. **QB rushing yards + WR receiving yards, same team, both over** → slight reduction (negative corr)

When detected: shows standard EV vs adjusted EV side-by-side with a yellow warning.

## Leg Selection Principles
- Only include legs where your P(Over) meaningfully exceeds the break-even rate
- A 56% P(Over) on a 3-pick Power (55.0% BE) is marginal — thin edge
- A 65% P(Over) on a 3-pick Power is strong — 10-point margin above break-even
- Avoid: B2B players with fatigue score ≥ 60
- Avoid: Props with blowoutRisk ≥ 35% (game environment risk)
- Avoid: Same-team correlations that trigger payout shift warnings

## Power vs Flex Decision
- **Power**: All picks must win for payout. Best for high-confidence legs.
- **Flex**: Allows 1–2 misses on 3–6 leg entries. Best for 5–6 legs (lower break-even).
- For 5 or 6 legs, Flex always has lower break-even — default to Flex unless very high confidence.

## Adding Picks to an Entry
1. Go to Slate Board
2. Click a player row → PropDetailSheet opens
3. Select MORE or LESS direction
4. Click "Add to Entry"
5. Entry Builder (sidebar icon shows count)
6. Set Power/Flex and stake in Entry Builder
7. Review Pick'em Math panel
8. Click "Log Entry" to record it

## Bankroll Exposure Check
Before logging an entry the app checks
your daily loss limit from Settings.
Green: below 50% of daily limit used.
Amber: 50-80% used. Slow down.
Red: above 80%. Consider waiting.
Set your daily loss limit in Settings
to enable this feature.

## CLV on Settled Picks
When you mark a pick as hit or miss
the app automatically pulls the closing
PrizePicks line from history.
CLV = closing line minus your entry line.
Positive CLV (green ✅): line moved your
direction after you locked. You beat
the market.
Negative CLV (red ❌): line moved against
you. Market disagreed with your read.
Track CLV in Journal to measure whether
your process is finding real edge or
getting lucky.

## Expandable Row Charts
Click the expand chevron on any prop row
to see three charts:
1. Recent Form: last 10 games vs tonight
   line. Green = exceeded, red = missed.
2. Hit Rate: historical % over this line.
3. Distribution: normal curve showing
   where the line falls vs your projection.
Charts unlock when 5+ game logs exist.

## Pre-Lock Refresh
In the 2 hours before any game locks
VibeMeGood automatically syncs PP lines
every minute instead of every 10 minutes.
Amber banner shows: "⚡ Pre-lock refresh
active — syncing every minute"
This catches late line moves that create
or destroy edge near lock time.

## Preset Filters
Four preset filter configurations:
Safe: Stable variance, P(Over) ≥ 58%,
PLAY tag only.
Upside: P(Over) ≥ 62%, any action tag.
Late-News: Props with recent injury updates.
My Style: Your custom saved filters.
Unlocks after 30 paper trades logged.
Until then: build your own filter intuition.
