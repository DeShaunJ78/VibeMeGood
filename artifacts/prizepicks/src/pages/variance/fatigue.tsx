import { Battery } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface VarianceRow {
  ppLineId: number;
  statType: string;
  fatigueScore: number | null;
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

function FatigueMeter({ score }: { score: number }) {
  const color = score >= 60 ? "bg-rose-500" : score >= 40 ? "bg-amber-500" : score >= 20 ? "bg-yellow-500" : "bg-emerald-500";
  const label = score >= 60 ? "Heavy Load" : score >= 40 ? "Moderate" : score >= 20 ? "Mild" : "Rested";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px] font-mono">
        <span className="text-muted-foreground">Fatigue</span>
        <span className={score >= 60 ? "text-rose-400" : score >= 40 ? "text-amber-400" : "text-emerald-400"}>
          {score}/100 · {label}
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(2, score)}%` }} />
      </div>
    </div>
  );
}

export default function FatigueTracker() {
  const { data, isLoading } = useVarianceScores();

  const sorted = [...(data ?? [])].sort((a, b) => (b.fatigueScore ?? 0) - (a.fatigueScore ?? 0));
  const highFatigue = sorted.filter(r => (r.fatigueScore ?? 0) >= 40);
  const rested = sorted.filter(r => (r.fatigueScore ?? 0) < 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Battery className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fatigue Tracker</h1>
          <p className="text-sm text-muted-foreground font-mono">Rest load modeling from schedule data</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800" />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground font-mono">
          <Battery className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No fatigue data available. Run Force Sync to compute variance scores.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-rose-400 flex items-center gap-2">
                <Battery className="w-4 h-4" /> High Fatigue Load
                <span className="ml-auto text-muted-foreground">{highFatigue.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {highFatigue.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono">No high-fatigue props</p>
              ) : highFatigue.slice(0, 10).map(r => (
                <div key={r.ppLineId} className="space-y-2 p-3 bg-slate-950 rounded border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">{r.statType}</span>
                    {r.warnings?.includes("back_to_back") && (
                      <span className="text-[9px] font-mono bg-rose-900/40 text-rose-400 border border-rose-700/40 px-1.5 py-0.5 rounded">B2B</span>
                    )}
                  </div>
                  <FatigueMeter score={r.fatigueScore ?? 0} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <Battery className="w-4 h-4" /> Well Rested — Advantage
                <span className="ml-auto text-muted-foreground">{rested.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rested.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono">No rested props identified</p>
              ) : rested.slice(0, 10).map(r => (
                <div key={r.ppLineId} className="space-y-2 p-3 bg-slate-950 rounded border border-slate-800">
                  <span className="font-mono text-sm font-bold">{r.statType}</span>
                  <FatigueMeter score={r.fatigueScore ?? 0} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
