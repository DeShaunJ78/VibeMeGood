import { Router } from "express";
import { simulateEntry, type SimLeg } from "../lib/simulation/entry-simulator";
import { logger } from "../lib/logger";

const POWER_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };

interface PortfolioProp {
  playerId: number;
  statType: string;
  lineValue: number;
  lineType: string;
  direction: "more" | "less";
  playerName: string;
  sport: string;
  team: string;
  gameId: string;
  position?: string;
  mean: number;
  stdDev: number;
  modelProb: number;
  vor: number | null;
}

interface PortfolioEntry {
  legs: PortfolioProp[];
  entryType: "power";
  multiplier: number;
  trueJointProbability: number;
  adjustedEV: number;
  portfolioScore: number;
}

function combinations<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr as [T, ...T[]];
  const withFirst = combinations(rest, size - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

const router = Router();

router.post("/portfolio/optimize", async (req, res) => {
  try {
    const { props, entrySize, maxEntries } = req.body as {
      props: PortfolioProp[];
      entrySize: 2 | 3;
      maxEntries: number;
    };

    if (!Array.isArray(props) || props.length < (entrySize ?? 2)) {
      return res.status(400).json({ error: "Need at least entrySize props" });
    }

    const size = entrySize ?? 3;
    const cap = Math.min(Math.max(maxEntries ?? 5, 1), 20);
    const multiplier = POWER_MULTIPLIERS[size] ?? 6;
    const combos = combinations(props, size);
    const scoredEntries: PortfolioEntry[] = [];

    for (const combo of combos) {
      const legs: SimLeg[] = combo.map(p => ({
        playerName: p.playerName,
        statType: p.statType,
        line: p.lineValue,
        side: p.direction === "more" ? "over" : "under",
        modelProb: p.modelProb,
        sport: p.sport,
        team: p.team,
        gameId: p.gameId,
        position: p.position,
        mean: p.mean,
        stdDev: p.stdDev,
      }));

      const simResult = simulateEntry({ legs, runs: 1000, multiplier });

      // Correlation penalty: 20 pts if any two legs share same team and same direction
      let correlationPenalty = 0;
      outer: for (let i = 0; i < combo.length; i++) {
        for (let j = i + 1; j < combo.length; j++) {
          if (combo[i].team === combo[j].team && combo[i].direction === combo[j].direction) {
            correlationPenalty = 20;
            break outer;
          }
        }
      }

      const vorAvg = combo.reduce((sum, p) => sum + (p.vor ?? 0), 0) / combo.length;
      const portfolioScore = simResult.adjustedEV * 100 + vorAvg * 10 - correlationPenalty;

      scoredEntries.push({
        legs: combo,
        entryType: "power",
        multiplier,
        trueJointProbability: simResult.trueJointProbability,
        adjustedEV: simResult.adjustedEV,
        portfolioScore,
      });
    }

    scoredEntries.sort((a, b) => b.portfolioScore - a.portfolioScore);

    // Select top entries ensuring no two share more than 1 player
    const selected: PortfolioEntry[] = [];
    for (const entry of scoredEntries) {
      let ok = true;
      for (const sel of selected) {
        const shared = entry.legs.filter(l =>
          sel.legs.some(sl => sl.playerId === l.playerId),
        ).length;
        if (shared > 1) { ok = false; break; }
      }
      if (ok) {
        selected.push(entry);
        if (selected.length >= cap) break;
      }
    }

    const totalPortfolioEV = selected.reduce((sum, e) => sum + e.adjustedEV, 0);

    return res.json({
      entries: selected,
      totalPortfolioEV,
      generated: combos.length,
    });
  } catch (err) {
    logger.error({ err }, "portfolio optimize error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
