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
}

interface EntryContextValue {
  picks: EntryPick[];
  addPick: (pick: EntryPick) => void;
  removePick: (ppLineId: number) => void;
  updateDirection: (ppLineId: number, direction: "more" | "less") => void;
  clearPicks: () => void;
  hasPick: (ppLineId: number) => boolean;
}

const EntryContext = createContext<EntryContextValue | null>(null);

export function EntryProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<EntryPick[]>([]);

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

  const clearPicks = useCallback(() => setPicks([]), []);

  const hasPick = useCallback((ppLineId: number) => picks.some(p => p.ppLineId === ppLineId), [picks]);

  return (
    <EntryContext.Provider value={{ picks, addPick, removePick, updateDirection, clearPicks, hasPick }}>
      {children}
    </EntryContext.Provider>
  );
}

export function useEntry() {
  const ctx = useContext(EntryContext);
  if (!ctx) throw new Error("useEntry must be used within EntryProvider");
  return ctx;
}
