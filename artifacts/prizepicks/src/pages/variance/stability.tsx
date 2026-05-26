import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface VarianceRow {
  ppLineId: number;
  playerId: number;
  statType: string;
  playerName: string | null;
  sport: string | null;
  volatilityRating: string | null;
  fatigueScore: number | null;
  usageScore: number | null;
  matchupScore: number | null;
  environmentScore: number | null;
  blowoutRisk: number | null;
  warnings: string[] | null;
  whyItMoves: string | null;
}

function useVarianceScores() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return useQuery<VarianceRow[]>({
    queryKey: ["variance-scores"],
    queryFn: async () => {
      const r = await fetch(`${base}/api/variance`);
      if (!r.ok) throw new Error("Failed to load variance scores");
      return r.json();
    },
    staleTime: 60_000,
  });
}

const RATING_COLOR: Record<string, string> = {
  stable:    "text-emerald-400 border-emerald-700/40 bg-emerald-900/20",
  elevated:  "text-amber-400 border-amber-700/40 bg-amber-900/20",
  high:      "text-rose-400 border-rose-700/40 bg-rose-900/20",
  boom_bust: "text-violet-400 border-violet-700/40 bg-violet-900/20",
};

type SortDir = "asc" | "desc";
type StabilitySortCol = "playerName" | "blowoutRisk" | "usageScore";

function SortPills({
  sortCol, sortDir, onSort,
}: { sortCol: StabilitySortCol; sortDir: SortDir; onSort: (c: StabilitySortCol) => void }) {
  const opts: { col: StabilitySortCol; label: string }[] = [
    { col: "playerName",  label: "Name" },
    { col: "blowoutRisk", label: "Blowout" },
    { col: "usageScore",  label: "Usage" },
  ];
  return (
    <div className="flex items-center gap-1 ml-auto">
      {opts.map(({ col, label }) => (
        <button
          key={col}
          onClick={() => onSort(col)}
          className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
            sortCol === col
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground border border-transparent"
          }`}
        >
          {label}{sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      ))}
    </div>
  );
}

function sortRows(rows: VarianceRow[], col: StabilitySortCol, dir: SortDir) {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case "playerName":  cmp = (a.playerName ?? "").localeCompare(b.playerName ?? ""); break;
      case "blowoutRisk": cmp = (a.blowoutRisk ?? 0) - (b.blowoutRisk ?? 0); break;
      case "usageScore":  cmp = (a.usageScore ?? 0) - (b.usageScore ?? 0); break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

export default function StabilityRadar() {
  const { data, isLoading } = useVarianceScores();
  const [sortCol, setSortCol] = useState<StabilitySortCol>("playerName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(col: StabilitySortCol) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir(col === "playerName" ? "asc" : "desc");
    }
  }

  const grouped = useMemo(() => ({
    stable:   sortRows((data ?? []).filter(r => r.volatilityRating === "stable"), sortCol, sortDir),
    elevated: sortRows((data ?? []).filter(r => r.volatilityRating === "elevated"), sortCol, sortDir),
    high:     sortRows((data ?? []).filter(r => r.volatilityRating === "high" || r.volatilityRating === "boom_bust"), sortCol, sortDir),
  }), [data, sortCol, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Stability Radar</h1>
            <p className="text-sm text-muted-foreground font-mono">Volatility classification across all active props</p>
          </div>
        </div>
        {data && (
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-emerald-400">{grouped.stable.length} stable</span>
            <span className="text-amber-400">{grouped.elevated.length} elevated</span>
            <span className="text-rose-400">{grouped.high.length} volatile</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground font-mono">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No variance scores computed yet.</p>
          <p className="text-xs mt-1">Run Force Sync to compute variance for active props.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-mono text-slate-500 uppercase mr-1">Sort within tiers:</span>
            <SortPills sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(["stable", "elevated", "high"] as const).map(tier => {
              const rows = grouped[tier];
              const label = tier === "high" ? "Volatile / Boom-Bust" : tier.charAt(0).toUpperCase() + tier.slice(1);
              const colorClass = RATING_COLOR[tier === "high" ? "high" : tier];
              return (
                <Card key={tier} className="bg-slate-900 border-slate-800">
                  <CardHeader className="pb-3">
                    <CardTitle className={`text-sm font-mono uppercase tracking-wider flex items-center gap-2 ${colorClass.split(" ")[0]}`}>
                      <span className={`inline-block w-2 h-2 rounded-full ${tier === "stable" ? "bg-emerald-400" : tier === "elevated" ? "bg-amber-400" : "bg-rose-400"}`} />
                      {label}
                      <span className="ml-auto text-muted-foreground">{rows.length}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground font-mono">None</p>
                    ) : rows.slice(0, 8).map(r => (
                      <div key={r.ppLineId} className={`p-2 rounded border text-xs ${colorClass}`}>
                        <div className="font-semibold">{r.playerName ?? "Unknown"}</div>
                        <div className="text-[9px] font-mono opacity-60">{r.statType}{r.sport ? ` · ${r.sport}` : ""}</div>
                        {r.whyItMoves && <div className="text-[10px] opacity-70 mt-0.5 truncate">{r.whyItMoves}</div>}
                        {r.warnings && r.warnings.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {r.warnings.slice(0, 3).map(w => (
                              <span key={w} className="text-[9px] bg-slate-800/60 px-1 py-0.5 rounded">{w.replace(/_/g, " ")}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {rows.length > 8 && (
                      <p className="text-[10px] text-muted-foreground font-mono text-center">+{rows.length - 8} more</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
