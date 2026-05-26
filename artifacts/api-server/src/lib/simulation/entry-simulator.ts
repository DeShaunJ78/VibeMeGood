import {
  getDistribution,
  sampleCorrelated,
  type DistType,
} from "./distributions";
import {
  buildCorrelationMatrix,
  choleskyDecompose,
  correlatedNormals,
  getCorrelationPairs,
  type LegContext,
} from "./correlation";

export interface SimLeg {
  playerName: string;
  statType: string;
  line: number;
  side: "over" | "under";
  modelProb: number;
  sport: string;
  team: string;
  gameId: string;
  position?: string;
  mean: number;
  stdDev: number;
}

export interface SimResult {
  trueJointProbability: number;
  naiveProbability: number;
  correlationAdjustment: number;
  entryEV: number;
  adjustedEV: number;
  runCount: number;
  correlationDetails: {
    hasPositiveCorrelation: boolean;
    hasNegativeCorrelation: boolean;
    dominantPairs: string[];
  };
}

export function simulateEntry(config: {
  legs: SimLeg[];
  runs: number;
  multiplier: number;
}): SimResult {
  const { legs, runs, multiplier } = config;

  const naiveProbability = legs.reduce((acc, l) => acc * l.modelProb, 1);

  if (legs.length === 0) {
    return {
      trueJointProbability: 0,
      naiveProbability: 0,
      correlationAdjustment: 0,
      entryEV: -1,
      adjustedEV: -1,
      runCount: 0,
      correlationDetails: { hasPositiveCorrelation: false, hasNegativeCorrelation: false, dominantPairs: [] },
    };
  }

  const legContexts: LegContext[] = legs.map(l => ({
    sport: l.sport,
    team: l.team,
    gameId: l.gameId,
    statType: l.statType,
    position: l.position,
  }));

  const distributions: DistType[] = legs.map(l =>
    getDistribution(l.sport, l.statType),
  );

  const corrMatrix = buildCorrelationMatrix(legContexts);
  const L = choleskyDecompose(corrMatrix);

  const n = legs.length;
  let allHit = 0;

  for (let r = 0; r < runs; r++) {
    const correlated = correlatedNormals(L);
    let runHit = true;

    for (let i = 0; i < n; i++) {
      const leg = legs[i];
      const sample = sampleCorrelated(
        distributions[i],
        leg.mean,
        Math.max(leg.stdDev, 0.01),
        correlated[i],
      );
      const hit =
        leg.side === "over" ? sample > leg.line : sample < leg.line;
      if (!hit) { runHit = false; break; }
    }

    if (runHit) allHit++;
  }

  const trueJointProbability = allHit / runs;
  const correlationAdjustment = trueJointProbability - naiveProbability;
  const entryEV = trueJointProbability * multiplier - 1;

  const pairs = getCorrelationPairs(legContexts);
  const hasPositiveCorrelation = pairs.some(p => p.corr > 0.1);
  const hasNegativeCorrelation = pairs.some(p => p.corr < -0.1);

  const sorted = [...pairs].sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
  const dominantPairs = sorted.slice(0, 3).map(p => {
    const sign = p.corr > 0 ? "+" : "";
    return `${legs[p.i].playerName} + ${legs[p.j].playerName} (${sign}${(p.corr * 100).toFixed(0)}%)`;
  });

  return {
    trueJointProbability,
    naiveProbability,
    correlationAdjustment,
    entryEV,
    adjustedEV: entryEV,
    runCount: runs,
    correlationDetails: { hasPositiveCorrelation, hasNegativeCorrelation, dominantPairs },
  };
}
