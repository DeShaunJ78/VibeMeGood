# VibeMeGood — Odds Math Precision Patch
### Three targeted additions: no-vig probability, hold display, decimal math.
### Apply to existing codebase. Do not rebuild anything that already works.

---

## WHAT THIS FIXES

**Current True Edge calculation:**
```
True Edge = (external_line - PP_line) / PP_line × 100
```
This is a line comparison. DK has 26.0, PP has 24.5 → 6.1% edge.
It says nothing about whether the 26.0 line is at -110 or -150.
A DK line of 26.0 at -150 is much less attractive than 26.0 at -110.

**Correct calculation:**
Strip the vig from the external book odds to get fair probability.
Compare PP's implied line to that fair probability.
Show hold % so the user knows how juicy the market is.

---

## STEP 1 — Install decimal.js

```bash
# In artifacts/api-server:
pnpm add decimal.js
pnpm add -D @types/decimal.js

# In artifacts/prizepicks (for display formatting only):
pnpm add decimal.js
```

---

## STEP 2 — New Odds Math Utility

**File:** `artifacts/api-server/src/lib/analytics/odds-math.ts` (NEW FILE)

```typescript
import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ─── Conversions ─────────────────────────────────────────────────────────────

export function americanToDecimalOdds(american: number): Decimal {
  if (american === 0) throw new Error("American odds cannot be 0");
  if (american > 0) return new Decimal(1).plus(new Decimal(american).div(100));
  return new Decimal(1).plus(new Decimal(100).div(Math.abs(american)));
}

export function impliedProbability(american: number): Decimal {
  if (american > 0) return new Decimal(100).div(new Decimal(american).plus(100));
  if (american < 0) return new Decimal(Math.abs(american)).div(new Decimal(Math.abs(american)).plus(100));
  throw new Error("American odds cannot be 0");
}

// ─── Hold ────────────────────────────────────────────────────────────────────

/**
 * Market hold for a two-way market (over/under).
 * Returns decimal: 0.045 = 4.5% hold.
 * Returns null if either price is missing.
 */
export function twoWayHold(overAmerican: number, underAmerican: number): Decimal | null {
  try {
    const overProb  = impliedProbability(overAmerican);
    const underProb = impliedProbability(underAmerican);
    return overProb.plus(underProb).minus(1);
  } catch {
    return null;
  }
}

export function holdWarning(hold: Decimal): "low" | "moderate" | "high" | null {
  if (hold.lessThan("0.03"))  return "low";
  if (hold.lessThan("0.07"))  return "moderate";
  return "high";
}

// ─── No-Vig ──────────────────────────────────────────────────────────────────

/**
 * Strip the vig from a two-way market to get fair (true) probabilities.
 * Returns { overFair, underFair } where both sum to 1.0.
 */
export function noVigProbs(
  overAmerican: number,
  underAmerican: number,
): { overFair: Decimal; underFair: Decimal } | null {
  try {
    const overProb  = impliedProbability(overAmerican);
    const underProb = impliedProbability(underAmerican);
    const total     = overProb.plus(underProb);
    if (total.lessThanOrEqualTo(0)) return null;
    return {
      overFair:  overProb.div(total),
      underFair: underProb.div(total),
    };
  } catch {
    return null;
  }
}

// ─── EV and Kelly (now with Decimal precision) ────────────────────────────────

export function evPerUnit(modelProb: Decimal, american: number): Decimal {
  const dec       = americanToDecimalOdds(american);
  const netWin    = dec.minus(1);
  const loseProb  = new Decimal(1).minus(modelProb);
  return modelProb.times(netWin).minus(loseProb);
}

export function edgePct(modelProb: Decimal, fairProb: Decimal): Decimal {
  return modelProb.minus(fairProb);
}

export function kellyFraction(modelProb: Decimal, american: number): Decimal {
  const dec = americanToDecimalOdds(american);
  const b   = dec.minus(1);
  const q   = new Decimal(1).minus(modelProb);
  const raw = b.times(modelProb).minus(q).div(b);
  return Decimal.max(0, raw);
}

export function fractionalKellyStake(
  bankroll: Decimal,
  modelProb: Decimal,
  american: number,
  multiplier: Decimal = new Decimal("0.25"),
  maxBetPct: Decimal  = new Decimal("0.005"),
): Decimal {
  const raw    = kellyFraction(modelProb, american).times(multiplier);
  const capped = Decimal.min(raw, maxBetPct);
  return bankroll.times(capped).toDecimalPlaces(2);
}

// ─── Consensus fair probability across multiple books ────────────────────────

/**
 * Given multiple books' no-vig over probabilities, return the consensus.
 * Simple average — can be weighted by book reliability later.
 */
export function consensusFairProb(noVigOverProbs: Decimal[]): Decimal | null {
  if (!noVigOverProbs.length) return null;
  const sum = noVigOverProbs.reduce((a, b) => a.plus(b), new Decimal(0));
  return sum.div(noVigOverProbs.length);
}
```

---

## STEP 3 — Add Price Columns to external_lines Schema

**File:** `lib/db/src/schema/external-lines.ts`

```typescript
export const externalLinesTable = pgTable("external_lines", {
  id:           serial("id").primaryKey(),
  ppLineId:     integer("pp_line_id").references(() => ppLinesTable.id),
  playerId:     integer("player_id").references(() => playersTable.id),
  bookName:     varchar("book_name", { length: 50 }),
  statType:     varchar("stat_type", { length: 100 }),
  lineValue:    numeric("line_value"),

  // ADD THESE — American odds prices from the external book
  overPrice:    integer("over_price"),    // e.g., -110 for the over
  underPrice:   integer("under_price"),   // e.g., -110 for the under

  // Computed from prices (store so we don't recompute on every read)
  holdPct:      numeric("hold_pct"),      // e.g., 0.0476 = 4.76%
  noVigOverProb: numeric("no_vig_over_prob"), // e.g., 0.5000

  capturedAt:   timestamp("captured_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("external_lines_unique").on(t.ppLineId, t.bookName),
}));
```

**Run migration:**
```sql
ALTER TABLE external_lines
  ADD COLUMN over_price      INTEGER,
  ADD COLUMN under_price     INTEGER,
  ADD COLUMN hold_pct        NUMERIC,
  ADD COLUMN no_vig_over_prob NUMERIC;
```

---

## STEP 4 — Capture Prices in External Odds Sync

**File:** `artifacts/api-server/src/lib/sync/external-odds.ts`

The Odds API returns both over and under prices for player props. Currently the sync
captures only the line value. Update it to also capture the prices.

Find where outcomes are processed and the line is stored. The Odds API response for
a player prop looks like:

```json
{
  "outcomes": [
    { "name": "Over", "price": -110, "point": 24.5 },
    { "name": "Under", "price": -115, "point": 24.5 }
  ]
}
```

Update the upsert to capture and compute:

```typescript
import Decimal from "decimal.js";
import { twoWayHold, noVigProbs } from "../analytics/odds-math";

// When processing a market's outcomes:
const overOutcome  = outcomes.find(o => o.name?.toLowerCase() === "over");
const underOutcome = outcomes.find(o => o.name?.toLowerCase() === "under");

const overPrice  = overOutcome?.price  ? Number(overOutcome.price)  : null;
const underPrice = underOutcome?.price ? Number(underOutcome.price) : null;
const lineValue  = overOutcome?.point  ?? underOutcome?.point ?? null;

// Compute hold and no-vig if both prices available
let holdPct: string | null = null;
let noVigOverProb: string | null = null;

if (overPrice && underPrice) {
  const hold = twoWayHold(overPrice, underPrice);
  if (hold) holdPct = hold.toFixed(6);

  const nvProbs = noVigProbs(overPrice, underPrice);
  if (nvProbs) noVigOverProb = nvProbs.overFair.toFixed(6);
}

// In the upsert:
await db.insert(externalLinesTable).values({
  ppLineId, playerId, bookName, statType,
  lineValue: lineValue?.toString() ?? null,
  overPrice,
  underPrice,
  holdPct,
  noVigOverProb,
  capturedAt: new Date(),
}).onConflictDoUpdate({
  target: [externalLinesTable.ppLineId, externalLinesTable.bookName],
  set: {
    lineValue:      lineValue?.toString() ?? null,
    overPrice,
    underPrice,
    holdPct,
    noVigOverProb,
    capturedAt: new Date(),
  },
});
```

---

## STEP 5 — Update Market-Intel Route

**File:** `artifacts/api-server/src/routes/market-intel.ts`

Replace the current True Edge calculation with no-vig-based edge.
Add hold % to the response.

```typescript
import Decimal from "decimal.js";
import { consensusFairProb, edgePct, holdWarning } from "../lib/analytics/odds-math";

// In the market-intel calculation, after fetching external lines:
const extLines = await db.select().from(externalLinesTable)
  .where(eq(externalLinesTable.ppLineId, line.id));

// Collect no-vig over probabilities from each book
const noVigProbs: Decimal[] = extLines
  .filter(l => l.noVigOverProb !== null)
  .map(l => new Decimal(l.noVigOverProb!.toString()));

// Compute consensus fair probability
const fairProb = consensusFairProb(noVigProbs);

// PP's implied over probability (treat PP line as no-vig since they set it)
// For PrizePicks, the "fair" side of a line is the line itself vs our projection
// True edge is: our model probability vs consensus market fair probability
const modelPOver = proj?.pOver ? new Decimal(proj.pOver.toString()).div(100) : null;

// True edge (new — vs no-vig, not vs raw implied)
const trueEdgeNoVig = (fairProb && modelPOver)
  ? edgePct(modelPOver, fairProb).times(100).toDecimalPlaces(2).toNumber()
  : null;

// Average hold across books (for display)
const holdValues = extLines
  .filter(l => l.holdPct !== null)
  .map(l => new Decimal(l.holdPct!.toString()));
const avgHold = holdValues.length
  ? holdValues.reduce((a, b) => a.plus(b), new Decimal(0)).div(holdValues.length)
  : null;

const holdPct = avgHold ? avgHold.times(100).toDecimalPlaces(2).toNumber() : null;
const holdRating = avgHold ? holdWarning(avgHold) : null;

// Per-book hold breakdown for detail sheet
const bookHolds = extLines
  .filter(l => l.holdPct !== null)
  .map(l => ({
    book:    l.bookName,
    holdPct: new Decimal(l.holdPct!.toString()).times(100).toDecimalPlaces(2).toNumber(),
    overPrice:  l.overPrice,
    underPrice: l.underPrice,
  }));

// Add to response object:
return {
  // ... existing fields ...
  trueEdge:         trueEdgeNoVig,    // renamed from old trueEdge — now no-vig based
  fairProb:         fairProb ? fairProb.times(100).toDecimalPlaces(2).toNumber() : null,
  marketHoldPct:    holdPct,          // average hold across books
  holdRating:       holdRating,       // "low" | "moderate" | "high" | null
  bookHolds,                          // per-book breakdown
};
```

---

## STEP 6 — Slate Board Display

**File:** `artifacts/prizepicks/src/pages/slate-board.tsx`

### Add Hold% column header

```tsx
// After True Edge header:
<TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-right">
  Hold%
</TableHead>
```

### Add Hold% cell in row body

```tsx
// After True Edge cell:
<TableCell className="hidden lg:table-cell font-mono text-xs text-right">
  {row.marketHoldPct != null ? (
    <span className={
      row.holdRating === "low"      ? "text-emerald-400" :
      row.holdRating === "moderate" ? "text-amber-400"   :
      row.holdRating === "high"     ? "text-rose-400"    :
      "text-muted-foreground"
    }>
      {row.marketHoldPct.toFixed(1)}%
    </span>
  ) : (
    <span className="text-slate-700">—</span>
  )}
</TableCell>
```

### Update True Edge label to clarify it's no-vig based

```tsx
// Update the column header tooltip:
<TableHead className="hidden lg:table-cell w-22 font-mono text-xs text-right">
  <Tooltip>
    <TooltipTrigger>True Edge</TooltipTrigger>
    <TooltipContent className="text-xs max-w-xs">
      Our model probability vs consensus no-vig market probability.
      Vig has been stripped from external book lines.
    </TooltipContent>
  </Tooltip>
</TableHead>
```

---

## STEP 7 — Prop Detail Sheet: Hold and Fair Probability Panel

**File:** `artifacts/prizepicks/src/components/prop-detail-sheet.tsx`

Add a market math panel to the detail sheet:

```tsx
{/* Market Math Panel — show when external lines exist */}
{detail.bookHolds && detail.bookHolds.length > 0 && (
  <div className="space-y-3 pt-3 border-t border-slate-800">
    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
      Market Math
    </div>

    {/* Fair probability */}
    {detail.fairProb != null && (
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground">Consensus fair P(over)</span>
        <span className="text-foreground font-bold">{detail.fairProb.toFixed(1)}%</span>
      </div>
    )}

    {/* Our model vs fair prob */}
    {detail.fairProb != null && detail.ourProjection?.pOver != null && (
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground">Our model P(over)</span>
        <span className={`font-bold ${
          detail.ourProjection.pOver > detail.fairProb
            ? "text-emerald-400" : "text-rose-400"
        }`}>
          {detail.ourProjection.pOver.toFixed(1)}%
        </span>
      </div>
    )}

    {/* Per-book hold breakdown */}
    <div className="space-y-1.5">
      <div className="text-[10px] font-mono text-muted-foreground">Book Hold</div>
      {detail.bookHolds.map((b: any) => (
        <div key={b.book} className="flex items-center justify-between text-[11px] font-mono">
          <span className="text-slate-400 capitalize">{b.book}</span>
          <div className="flex items-center gap-3">
            {b.overPrice && (
              <span className="text-slate-500">
                {b.overPrice > 0 ? `+${b.overPrice}` : b.overPrice} /&nbsp;
                {b.underPrice > 0 ? `+${b.underPrice}` : b.underPrice}
              </span>
            )}
            <span className={
              b.holdPct < 3   ? "text-emerald-400" :
              b.holdPct < 7   ? "text-amber-400"   :
                                "text-rose-400"
            }>
              {b.holdPct.toFixed(1)}%
            </span>
          </div>
        </div>
      ))}
    </div>

    {/* Hold color key */}
    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground pt-1">
      <span className="text-emerald-400">● &lt;3% fair</span>
      <span className="text-amber-400">● 3-7% moderate</span>
      <span className="text-rose-400">● &gt;7% juiced</span>
    </div>
  </div>
)}
```

---

## STEP 8 — Replace EV Calculation With Decimal Version

**File:** `artifacts/api-server/src/routes/market-intel.ts` and anywhere EV/Kelly is computed

Replace raw JavaScript arithmetic in EV and Kelly calculations:

```typescript
import Decimal from "decimal.js";
import { evPerUnit, fractionalKellyStake } from "../lib/analytics/odds-math";

// BEFORE (floating point):
const ev = modelProb * (decimalOdds - 1) - (1 - modelProb);

// AFTER (decimal precision):
const modelProbDecimal = new Decimal(modelProb.toString());
const ev = evPerUnit(modelProbDecimal, americanOdds).toNumber();

// BEFORE (floating point):
const kelly = Math.max(0, (b * p - q) / b) * 0.25;

// AFTER (decimal precision):
const kelly = fractionalKellyStake(
  new Decimal(bankroll),
  modelProbDecimal,
  americanOdds,
  new Decimal("0.25"),
  new Decimal("0.005"),
).toNumber();
```

Apply this replacement in:
- `market-intel.ts` — EV scoring per prop
- `routes/entries.ts` — Kelly stake recommendations in entry builder
- `routes/optimizer.ts` — EV calculation per optimizer pick

---

## STEP 9 — Update AI Analyst Context

**File:** `artifacts/api-server/src/routes/anthropic.ts`

Add hold and fair probability to the context injected into Claude:

```typescript
// In the slate context builder, add to each prop's context:
const propContext = `
${playerName} ${statType} ${lineValue} (${lineType})
  PP implied: ${ppImpliedProb}%
  Market fair prob (no-vig): ${fairProb ? fairProb + "%" : "unavailable"}
  Our model: ${pOver}%
  True edge (no-vig): ${trueEdge ? trueEdge + "%" : "no data"}
  Market hold: ${marketHoldPct ? marketHoldPct + "%" : "unknown"}
  ${holdRating === "high" ? "⚠ HIGH HOLD — juiced market, less reliable edge signal" : ""}
`.trim();
```

This means when you ask Claude to analyze a prop, it now knows whether the edge
is against a 3% hold market (reliable signal) or an 8% hold market (noisy signal).

---

## ACCEPTANCE TEST

```
[ ] 1. External lines table has over_price, under_price, hold_pct, no_vig_over_prob
       columns after migration.

[ ] 2. After running external odds sync, at least some external_lines records
       have non-null hold_pct and no_vig_over_prob values.

[ ] 3. Slate Board shows a Hold% column with color coding:
       Green = under 3%, Amber = 3-7%, Red = over 7%

[ ] 4. A market at -110/-110 shows hold of exactly 4.8%

[ ] 5. A market at -115/-115 shows hold of exactly 9.1%

[ ] 6. True Edge is now calculated as model P(over) minus no-vig fair probability,
       not model P(over) minus raw implied probability.
       For -110/-110 market: no-vig fair = 50%, not 52.4%.
       This makes a meaningful difference in edge calculation.

[ ] 7. Prop detail sheet shows:
       - Consensus fair P(over) from external books
       - Our model P(over)
       - Per-book hold breakdown with prices (e.g., DK: -110/-110 → 4.8%)

[ ] 8. EV and Kelly calculations use Decimal math.
       Verify: -110 odds, 58% model probability
       EV = (0.58 × 0.909) - (0.42 × 1) = 0.527 - 0.42 = +0.107 per unit
       Kelly = (0.909 × 0.58 - 0.42) / 0.909 = 0.107 / 0.909 = 11.8% raw
       Fractional (25%): 2.95% of bankroll

[ ] 9. AI Analyst context includes hold % and flags high-hold markets with a warning.

[ ] 10. When external books have no prices available (only line values),
        hold_pct and no_vig_over_prob are null, Hold% column shows — gracefully.
```

---

## WHAT THIS DOES NOT CHANGE

- The PP sync — unchanged
- The projection engine — unchanged
- The CLV calculation — unchanged (CLV compares locked line to closing line, not related to hold)
- The variance engine — unchanged
- The optimizer strategy — unchanged
- The Entry Builder — unchanged
- Any page that doesn't show market data

This patch touches only:
- The odds math utility (new file)
- The external_lines schema (2 new columns + 2 computed columns)
- The external odds sync (capture prices)
- The market-intel route (compute and return hold/no-vig)
- The Slate Board (one new column)
- The Prop Detail Sheet (one new panel)

