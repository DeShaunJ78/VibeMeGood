import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface EntryPick {
  ppLineId: number;
  playerId: number;
  playerName: string;
  imageUrl: string | null;
  teamAbbr: string | null;
  statType: string;
  lineValue: number;
  lineType: string;
  direction: "more" | "less";
  yourProjection: number | null;
  p99: number | null;
  pOver: number | null;
  edgeScore: number | null;
  actionTag: string | null;
  gameId?: number | null;
  // Extended fields for portfolio optimizer
  sport?: string;
  mean?: number;
  stdDev?: number;
  vor?: number | null;
  gamesUsed?: number | null;
}

export type OptimizationObjective =
  | "max_ev"
  | "max_profit_prob"
  | "min_drawdown"
  | "balanced_growth"
  | "high_ceiling"
  | "gpp_mode"
  | null;

interface EntryContextValue {
  picks: EntryPick[];
  optimizationObjective: OptimizationObjective;
  addPick: (pick: EntryPick) => void;
  removePick: (ppLineId: number) => void;
  updateDirection: (ppLineId: number, direction: "more" | "less") => void;
  clearPicks: () => void;
  hasPick: (ppLineId: number) => boolean;
  setOptimizationObjective: (obj: OptimizationObjective) => void;
}

const EntryContext = createContext<EntryContextValue | null>(null);

export function EntryProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<EntryPick[]>([]);
  const [optimizationObjective, setOptimizationObjective] = useState<OptimizationObjective>(null);

  const addPick = useCallback((pick: EntryPick) => {
    setPicks(prev => {
      if (prev.find(p => p.ppLineId === pick.ppLineId)) return prev;
      if (prev.length >= 6) return prev;
      return [...prev, pick];
    });
  }, []);

  const removePick = useCallback((ppLineId: number) => {
    setPicks(prev => prev.filter(p => p.ppLineId !== ppLineId));
  }, []);

  const updateDirection = useCallback((ppLineId: number, direction: "more" | "less") => {
    setPicks(prev => prev.map(p => p.ppLineId === ppLineId ? { ...p, direction } : p));
  }, []);

  const clearPicks = useCallback(() => {
    setPicks([]);
    setOptimizationObjective(null);
  }, []);

  const hasPick = useCallback((ppLineId: number) => picks.some(p => p.ppLineId === ppLineId), [picks]);

  return (
    <EntryContext.Provider value={{ picks, optimizationObjective, addPick, removePick, updateDirection, clearPicks, hasPick, setOptimizationObjective }}>
      {children}
    </EntryContext.Provider>
  );
}

export function useEntry() {
  const ctx = useContext(EntryContext);
  if (!ctx) throw new Error("useEntry must be used within EntryProvider");
  return ctx;
}
