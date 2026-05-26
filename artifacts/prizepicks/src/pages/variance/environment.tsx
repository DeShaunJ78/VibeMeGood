import { useState, useMemo } from "react";
import { Wind } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface VarianceRow {
  ppLineId: number;
  statType: string;
  playerName: string | null;
  sport: string | null;
  environmentScore: number | null;
  blowoutRisk: number | null;
  volatilityRating: string | null;
  warnings: string[] | null;
  whyItMoves: string | null;
}

function useVarianceScores() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return useQuery<VarianceRow[]>({
    queryKey: ["variance-scores"],
    queryFn: async () => {
      const r = await fetch(`${base}/api/variance`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });
}

type SortDir = "asc" | "desc";
type EnvSortCol = "blowoutRisk" | "environmentScore" | "playerName";

function SortPills({
  sortCol, sortDir, onSort, cols,
}: { sortCol: EnvSortCol; sortDir: SortDir; onSort: (c: EnvSortCol) => void; cols: { col: EnvSortCol; label: string }[] }) {
  return (
    <div className="flex items-center gap-1 ml-auto">
      {cols.map(({ col, label }) => (
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

function sortRows(rows: VarianceRow[], col: EnvSortCol, dir: SortDir) {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case "blowoutRisk":      cmp = (a.blowoutRisk ?? 0) - (b.blowoutRisk ?? 0); break;
      case "environmentScore": cmp = (a.environmentScore ?? 0) - (b.environmentScore ?? 0); break;
      case "playerName":       cmp = (a.playerName ?? "").localeCompare(b.playerName ?? ""); break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

export default function EnvironmentBoard() {
  const { data, isLoading } = useVarianceScores();
  const [riskSort, setRiskSort]     = useState<EnvSortCol>("blowoutRisk");
  const [riskSortDir, setRiskSortDir] = useState<SortDir>("desc");
  const [envSort, setEnvSort]       = useState<EnvSortCol>("environmentScore");
  const [envSortDir, setEnvSortDir] = useState<SortDir>("desc");

  function toggleRisk(col: EnvSortCol) {
    if (riskSort === col) { setRiskSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setRiskSort(col); setRiskSortDir(col === "playerName" ? "asc" : "desc"); }
  }
  function toggleEnv(col: EnvSortCol) {
    if (envSort === col) { setEnvSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setEnvSort(col); setEnvSortDir(col === "playerName" ? "asc" : "desc"); }
  }

  const highRisk = useMemo(() => {
    const base = (data ?? []).filter(r => (r.blowoutRisk ?? 0) >= 35);
    return sortRows(base, riskSort, riskSortDir);
  }, [data, riskSort, riskSortDir]);

  const goodEnv = useMemo(() => {
    const base = (data ?? []).filter(r => (r.environmentScore ?? 50) >= 70 && (r.blowoutRisk ?? 0) < 25);
    return sortRows(base, envSort, envSortDir);
  }, [data, envSort, envSortDir]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Wind className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Environment Board</h1>
          <p className="text-sm text-muted-foreground font-mono">Game environment signals: blowout risk, pace, spread impact</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800" />)}
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="text-center py-16 text-muted-foreground font-mono">
          <Wind className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No environment data. Run Force Sync to compute variance scores.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-rose-400 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-400" />
                Blowout Risk ≥35%
                <span className="text-muted-foreground">{highRisk.length}</span>
                <SortPills
                  sortCol={riskSort}
                  sortDir={riskSortDir}
                  onSort={toggleRisk}
                  cols={[{ col: "blowoutRisk", label: "Risk%" }, { col: "playerName", label: "Name" }]}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {highRisk.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono">No high-risk blowout games</p>
              ) : highRisk.slice(0, 10).map(r => (
                <div key={r.ppLineId} className="flex items-center justify-between p-3 bg-slate-950 rounded border border-rose-900/30">
                  <div>
                    <div className="font-semibold text-sm">{r.playerName ?? "Unknown"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{r.statType}{r.sport ? ` · ${r.sport}` : ""}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {r.warnings?.includes("blowout_risk_extreme") ? "⚠ Extreme blowout risk" : "Blowout sensitive"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-rose-400">{r.blowoutRisk}%</div>
                    <div className="text-[10px] text-muted-foreground font-mono">blowout risk</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                Favorable Environment
                <span className="text-muted-foreground">{goodEnv.length}</span>
                <SortPills
                  sortCol={envSort}
                  sortDir={envSortDir}
                  onSort={toggleEnv}
                  cols={[{ col: "environmentScore", label: "Env" }, { col: "playerName", label: "Name" }]}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {goodEnv.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono">No high-scoring environment props</p>
              ) : goodEnv.slice(0, 10).map(r => (
                <div key={r.ppLineId} className="flex items-center justify-between p-3 bg-slate-950 rounded border border-emerald-900/30">
                  <div>
                    <div className="font-semibold text-sm">{r.playerName ?? "Unknown"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{r.statType}{r.sport ? ` · ${r.sport}` : ""}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">Low blowout risk · High-pace environment</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-emerald-400">{r.environmentScore}/100</div>
                    <div className="text-[10px] text-muted-foreground font-mono">env score</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
