import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

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

export function evPerUnit(modelProb: Decimal, american: number): Decimal {
  const dec      = americanToDecimalOdds(american);
  const netWin   = dec.minus(1);
  const loseProb = new Decimal(1).minus(modelProb);
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

export function consensusFairProb(noVigOverProbs: Decimal[]): Decimal | null {
  if (!noVigOverProbs.length) return null;
  const sum = noVigOverProbs.reduce((a, b) => a.plus(b), new Decimal(0));
  return sum.div(noVigOverProbs.length);
}
