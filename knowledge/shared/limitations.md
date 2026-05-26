# Model Limitations and Honest Caveats

## What the Model Does Well
- Quantifying edge vs PrizePicks line using Bayesian probability estimates
- Tracking break-even rates precisely
- Detecting payout shifts from correlated legs
- Flagging fatigue and blowout risk with real schedule data
- Journaling and hit rate tracking over time

## What the Model Cannot Do
- Guarantee outcomes — probability is not certainty
- Predict injuries, late scratches, or coach decisions made post-lock
- Know what other sharp bettors are doing (no market flow data)
- Override the fundamental randomness of sports

## Data Freshness
- Lines sync every 10 minutes
- Injuries sync every 20 minutes
- Projections compute 3x daily (6 AM, 11 AM, 2 PM)
- Always check "last synced" timestamp before making decisions
- A projection is stale if it's older than 4 hours for a live slate

## The Assistant Will Tell You When It Doesn't Know
- It will not fabricate current lines or projections
- It will say "I don't have current data on that" rather than guess
- It will ask you to run a sync if data appears stale
