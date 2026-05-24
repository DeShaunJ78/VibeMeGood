import { Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface VarianceRow {
  ppLineId: number;
  statType: string;
  playerName: string | null;
  sport: string | null;
  usageScore: number | null;
  matchupScore: number | null;
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

export default function UsageSignals() {
  const { data, isLoading } = useVarianceScores();

  const spiked = (data ?? []).filter(r => (r.usageScore ?? 50) >= 72 || r.warnings?.includes("usage_volatile"))
    .sort((a, b) => (b.usageScore ?? 0) - (a.usageScore ?? 0));
  const shrinking = (data ?? []).filter(r => (r.usageScore ?? 50) <= 28 || r.warnings?.includes("minutes_risk"))
    .sort((a, b) => (a.usageScore ?? 0) - (b.usageScore ?? 0));
  const strongMatchup = (data ?? []).filter(r => (r.matchupScore ?? 50) >= 70)
    .sort((a, b) => (b.matchupScore ?? 0) - (a.matchupScore ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Activity className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usage Signals</h1>
          <p className="text-sm text-muted-foreground font-mono">Minutes trends, role changes, and matchup edges</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800" />)}
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="text-center py-16 text-muted-foreground font-mono">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No usage data. Run Force Sync to compute variance scores.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-violet-400 flex items-center gap-2">
                Usage Spike ↑
                <span className="ml-auto text-muted-foreground">{spiked.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {spiked.length === 0 ? <p className="text-xs text-muted-foreground font-mono">None</p>
                : spiked.slice(0, 8).map(r => (
                  <div key={r.ppLineId} className="p-2 bg-violet-900/20 border border-violet-700/30 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-xs truncate">{r.playerName ?? "Unknown"}</div>
                        <div className="text-[9px] font-mono text-muted-foreground">{r.statType}</div>
                      </div>
                      <span className="font-mono text-xs text-violet-400 shrink-0">{r.usageScore}/100</span>
                    </div>
                    {r.whyItMoves && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{r.whyItMoves}</div>}
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-orange-400 flex items-center gap-2">
                Role Shrinking ↓
                <span className="ml-auto text-muted-foreground">{shrinking.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {shrinking.length === 0 ? <p className="text-xs text-muted-foreground font-mono">None</p>
                : shrinking.slice(0, 8).map(r => (
                  <div key={r.ppLineId} className="p-2 bg-orange-900/20 border border-orange-700/30 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-xs truncate">{r.playerName ?? "Unknown"}</div>
                        <div className="text-[9px] font-mono text-muted-foreground">{r.statType}</div>
                      </div>
                      <span className="font-mono text-xs text-orange-400 shrink-0">{r.usageScore}/100</span>
                    </div>
                    {r.warnings?.includes("minutes_risk") && (
                      <span className="text-[9px] text-orange-300 font-mono">mins declining</span>
                    )}
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                Matchup Edge
                <span className="ml-auto text-muted-foreground">{strongMatchup.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {strongMatchup.length === 0 ? <p className="text-xs text-muted-foreground font-mono">None</p>
                : strongMatchup.slice(0, 8).map(r => (
                  <div key={r.ppLineId} className="p-2 bg-cyan-900/20 border border-cyan-700/30 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-xs truncate">{r.playerName ?? "Unknown"}</div>
                        <div className="text-[9px] font-mono text-muted-foreground">{r.statType}</div>
                      </div>
                      <span className="font-mono text-xs text-cyan-400 shrink-0">{r.matchupScore}%</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">historical over rate</div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
