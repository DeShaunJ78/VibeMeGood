# VibeMeGood — Daily Operating Flowchart

## MORNING ROUTINE (7:00–9:00 AM)

### Step 1 — System Status Check
Open: Settings and Data Health
Click: Run Health Check

All items must be GREEN before proceeding.

RED items — fix in this order:
1. Click Sync PP Lines → wait 30s
2. Click Sync Odds → wait 30s
3. Click Sync Projections → wait 60s
4. Click Rescore Props → wait 30s
5. Click Sync Injuries → wait 30s

If External Odds shows AMBER:
→ Normal. Odds flow from DraftData.
→ Open DraftData and run Ingest Odds.

If PrizePicks API shows AMBER (429):
→ Normal rate limiting. Wait 10 minutes.
→ Retries automatically.

### Step 2 — Run Quick Syncs
Click in order:
1. Sync Game Logs
2. Backfill Game IDs
3. Rescore Props

### Step 3 — Review Injury News
Open: Injuries and News
Flag any OUT or GTD players.
Remove from consideration.

### Step 4 — Slate Board Review
Open: Slate Board
Filter: Sport (NBA, MLB, etc.)
Sort: Overall Score descending

Look for:
- PLAY tags (overall >= 75, edge >= 60)
- WATCH tags with P(Over) > 58%
- VOR above 0.5

Avoid:
- Prior-only projections
- LOW confidence badges
- LOW SAMPLE calibration badge
- B2B players with high fatigue
- High blowout risk

## PRE-LOCK ROUTINE (60-30 min before)

### Step 5 — Final Line Check
Verify on Slate Board:
- Lines have not moved significantly
- True Edge still showing (not hidden)
- No late injury news

### Step 6 — Build Entry
Open: Entry Builder

Add 2-3 picks (Power) or 3-5 (Flex).
For each pick set MORE or LESS.
Check P(Hit) per leg.
Check Entry EV at bottom.

Entry Rules:
- Each leg P(Over) above break-even
  Power 2: above 50%
  Power 3: above 57.7%
  Flex 3: above 52%
- No B2B players
- No HIGH blowout risk
- EV indicator green or amber
- No more than 1 player per team
- LOG ENTRY before games lock

## EVENING ROUTINE (after games end)

### Step 7 — Mark Results
Open: Journal
Click each entry.
Mark each pick HIT or MISS.

### Step 8 — Run Nightly Syncs
Click in order:
1. Sync Game Logs
2. Backfill Game IDs
3. Run Calibration (limit 5000)

### Step 9 — Review CLV
Open: Journal
Check CLV column on settled picks.
Positive CLV = beat the closing line.
Target: positive CLV average over 30+ picks.

## WEEKLY REVIEW (every Sunday)

Open: Review Dashboard
Check:
- Hit Rate by sport and stat type
- CLV trend (should be positive)
- Entry P&L curve
- Bankroll vs starting balance

## GATING STATUS

Feature — Unlocks When:
PLAY tags — 30+ calibration records
Preset filters — 30+ entries logged
Portfolio optimizer — 30+ entries logged
Ensemble blending — 100+ calibration
Convergence signal — 5+ games + 5+ hits
Streak badges — 3+ consecutive games
Hit rate windows — 5+ games per window

## DAILY CHECKLIST

Morning:
- Health check all GREEN
- Sync Game Logs
- Backfill Game IDs
- Rescore Props
- Check injuries

Pre-lock:
- Review Slate Board PLAY and WATCH
- Verify True Edge not stale
- Check late injury news
- Build and log entry

Evening:
- Mark results in Journal
- Run Calibration
- Note CLV
