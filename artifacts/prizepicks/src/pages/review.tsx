import { useGetReviewStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Percent, DollarSign, Target, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface StatBiasBucket {
  sport: string | null;
  statType: string;
  tier: string;
  hitCount: number;
  sampleSize: number;
  hitRate: number | null;
  avgModelPOver: number | null;
  delta: number | null;
  hasEnoughData: boolean;
}

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

const EMOTION_EMOJI: Record<string, string> = {
  confident: "💪", neutral: "😐", frustrated: "😤",
  excited: "🔥", anxious: "😰", unknown: "🎯",
};

export default function Review() {
  const { data: stats, isLoading } = useGetReviewStats(undefined, {
    query: { queryKey: ["review-stats"] }
  });
  const [biasOpen, setBiasOpen] = useState(true);
  const [biasSortKey, setBiasSortKey] = useState<"hitRate" | "delta" | "sampleSize">("hitRate");
  const [biasSortDir, setBiasSortDir] = useState<"desc" | "asc">("desc");

  const { data: biasData } = useQuery<{ buckets: StatBiasBucket[] }>({
    queryKey: ["stat-bias"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/dashboard/stat-bias`);
      if (!r.ok) throw new Error("Failed to load stat bias");
      return r.json();
    },
    staleTime: 60_000,
  });

  const allBuckets = biasData?.buckets ?? [];
  const qualifiedBuckets = allBuckets.filter(b => b.hasEnoughData);

  function toggleBiasSort(key: typeof biasSortKey) {
    if (biasSortKey === key) {
      setBiasSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setBiasSortKey(key);
      setBiasSortDir("desc");
    }
  }

  // Qualified buckets sorted by chosen key; insufficient-data buckets appended at end
  const sortedQualified = [...qualifiedBuckets].sort((a, b) => {
    const av = a[biasSortKey] ?? -Infinity;
    const bv = b[biasSortKey] ?? -Infinity;
    return biasSortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });
  const insufficientBuckets = allBuckets.filter(b => !b.hasEnoughData);
  const sortedBuckets = [...sortedQualified, ...insufficientBuckets];

  const s = stats as any;

  return (
    <div className="space-y-6 h-full overflow-auto">
      <div className="border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Review Dashboard</h1>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 bg-slate-900" />)}
          </div>
          <Skeleton className="h-72 bg-slate-900 w-full" />
          <Skeleton className="h-64 bg-slate-900 w-full" />
        </div>
      ) : s ? (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total P&L"
              value={`${s.totalPnl >= 0 ? "+" : ""}$${Number(s.totalPnl).toFixed(2)}`}
              sub={`${s.totalEntries} settled entries`}
              icon={DollarSign}
              color={s.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
            <StatCard
              label="Entry Hit Rate"
              value={s.overallHitRate != null ? `${(s.overallHitRate * 100).toFixed(1)}%` : "—"}
              sub="wins / settled"
              icon={Percent}
              color="text-primary"
            />
            <StatCard
              label="Pick Hit Rate"
              value={s.pickHitRate != null ? `${(Number(s.pickHitRate) * 100).toFixed(1)}%` : "—"}
              sub="individual legs"
              icon={TrendingUp}
              color="text-emerald-400"
            />
            <StatCard
              label="Avg CLV"
              value={s.avgClv != null ? `${Number(s.avgClv) > 0 ? "+" : ""}${Number(s.avgClv).toFixed(2)}` : "—"}
              sub="closing line value"
              icon={s.avgClv != null && Number(s.avgClv) >= 0 ? TrendingUp : TrendingDown}
              color={s.avgClv != null && Number(s.avgClv) >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
          </div>

          {/* Bankroll Curve */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">Bankroll Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                {s.bankrollCurve && s.bankrollCurve.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={s.bankrollCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <ReferenceLine y={1000} stroke="#334155" strokeDasharray="4 4" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", color: "#f8fafc", fontFamily: "monospace", fontSize: 11 }}
                        formatter={(v: any) => [`$${v}`, "Balance"]}
                      />
                      <Line type="monotone" dataKey="balance" stroke="#0ea5e9" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm font-mono">Not enough data</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Monthly P&L */}
          {s.monthlyPnl && s.monthlyPnl.length > 0 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">Monthly P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.monthlyPnl} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", color: "#f8fafc", fontFamily: "monospace", fontSize: 11 }}
                        formatter={(v: any, _: any, props: any) => {
                          const d = props.payload;
                          return [`$${Number(v).toFixed(2)}  (${d?.wins}W / ${d?.entries} entries)`, "P&L"];
                        }}
                      />
                      <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                        {(s.monthlyPnl as any[]).map((_: any, i: number) => (
                          <Cell key={i} fill={_.pnl >= 0 ? "#10b981" : "#f43f5e"} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Model Accuracy + Hit Rate Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Model Accuracy */}
            {s.modelAccuracy && (
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                    <Brain className="w-3.5 h-3.5 text-primary" />
                    Model Accuracy
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-center pt-2">
                    <div className={`text-4xl font-bold font-mono ${s.modelAccuracy.rate >= 0.55 ? "text-emerald-400" : s.modelAccuracy.rate >= 0.50 ? "text-amber-400" : "text-rose-400"}`}>
                      {s.modelAccuracy.rate != null ? `${(s.modelAccuracy.rate * 100).toFixed(1)}%` : "—"}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">projection direction correct</div>
                  </div>
                  <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${s.modelAccuracy.rate >= 0.55 ? "bg-emerald-500" : s.modelAccuracy.rate >= 0.50 ? "bg-amber-500" : "bg-rose-500"}`}
                      style={{ width: `${((s.modelAccuracy.rate ?? 0) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground text-center">
                    {s.modelAccuracy.correct} / {s.modelAccuracy.total} settled picks
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground bg-slate-800/50 rounded p-2">
                    <Target className="w-3 h-3 shrink-0" />
                    <span>projectionGap direction vs actual outcome</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* By Pick Count */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">By Pick Count</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5 pt-1">
                  {Object.entries((s.hitRateByPickCount as Record<string, any>) ?? {})
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([count, data]) => (
                      <div key={count} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground w-12">{count}-pick</span>
                        <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${((data.rate ?? 0) * 100).toFixed(0)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-primary w-10 text-right">
                          {data.rate != null ? `${(data.rate * 100).toFixed(0)}%` : "—"}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono w-14 text-right">
                          {data.wins}/{data.total}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* By Entry Type */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">By Entry Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 pt-1">
                  {Object.entries((s.hitRateByEntryType as Record<string, any>) ?? {}).map(([type, data]) => (
                    <div key={type} className="bg-slate-800/50 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-mono font-bold uppercase">{type}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{data.wins}W / {data.total} entries</div>
                      </div>
                      <div className={`text-2xl font-bold font-mono ${(data.rate ?? 0) >= 0.5 ? "text-emerald-400" : "text-rose-400"}`}>
                        {data.rate != null ? `${(data.rate * 100).toFixed(0)}%` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* By Stat Type */}
          {Array.isArray(s.statBreakdown) && s.statBreakdown.length > 0 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">Hit Rate by Stat Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-muted-foreground text-[10px] uppercase tracking-wider">
                        <th className="text-left py-2 pr-4">Stat Type</th>
                        <th className="text-right py-2 px-3">Picks</th>
                        <th className="text-right py-2 px-3">Hits</th>
                        <th className="text-right py-2 px-3">Hit Rate</th>
                        <th className="text-right py-2 pl-3">Avg Edge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(s.statBreakdown as Array<{ statType: string; pickCount: number; hitCount: number; hitRate: number | null; avgEdge: number | null }>).map((row) => (
                        <tr key={row.statType} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                          <td className="py-2 pr-4 text-slate-200 font-semibold">{row.statType}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{row.pickCount}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{row.hitCount}</td>
                          <td className="py-2 px-3 text-right">
                            <span className={`font-bold ${
                              row.hitRate == null ? "text-muted-foreground"
                              : row.hitRate >= 0.6 ? "text-emerald-400"
                              : row.hitRate >= 0.5 ? "text-amber-400"
                              : "text-rose-400"
                            }`}>
                              {row.hitRate != null ? `${(row.hitRate * 100).toFixed(1)}%` : "—"}
                            </span>
                          </td>
                          <td className="py-2 pl-3 text-right text-muted-foreground">
                            {row.avgEdge != null ? `${row.avgEdge.toFixed(1)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stat Type Edge Tracker */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setBiasOpen(v => !v)}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">Stat Type Edge</CardTitle>
                <div className="flex items-center gap-2">
                  {qualifiedBuckets.length > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">{qualifiedBuckets.length} buckets ≥ 10 picks</span>
                  )}
                  {biasOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Your personal hit rate vs. model projection by stat type and tier. Bias correction can be enabled in Settings.</p>
            </CardHeader>
            {biasOpen && (
              <CardContent>
                {allBuckets.length === 0 ? (
                  <div className="text-center py-6 text-xs font-mono text-muted-foreground">
                    No graded picks yet. Log entries and grade results to build your personal bias profile.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-muted-foreground text-[10px] uppercase tracking-wider">
                          <th className="text-left py-2 pr-4">Stat Type</th>
                          <th className="text-left py-2 pr-4">Tier</th>
                          <th className="text-left py-2 pr-4">Sport</th>
                          <th className="text-right py-2 px-2 cursor-pointer hover:text-foreground" onClick={() => toggleBiasSort("sampleSize")}>
                            Picks {biasSortKey === "sampleSize" ? (biasSortDir === "desc" ? "↓" : "↑") : ""}
                          </th>
                          <th className="text-right py-2 px-2 cursor-pointer hover:text-foreground" onClick={() => toggleBiasSort("hitRate")}>
                            Hit Rate {biasSortKey === "hitRate" ? (biasSortDir === "desc" ? "↓" : "↑") : ""}
                          </th>
                          <th className="text-right py-2 px-2 text-slate-400">Model P(Over)</th>
                          <th className="text-right py-2 pl-2 cursor-pointer hover:text-foreground" onClick={() => toggleBiasSort("delta")}>
                            Delta {biasSortKey === "delta" ? (biasSortDir === "desc" ? "↓" : "↑") : ""}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBuckets.map((b, i) => {
                          const insufficient = !b.hasEnoughData;
                          const deltaVal = b.delta ?? 0;
                          const deltaColor = insufficient ? "text-muted-foreground"
                            : deltaVal > 5 ? "text-emerald-400" : deltaVal < -5 ? "text-rose-400" : "text-amber-400";
                          const hitColor = insufficient || b.hitRate == null ? "text-muted-foreground"
                            : b.hitRate >= 0.6 ? "text-emerald-400"
                            : b.hitRate >= 0.5 ? "text-amber-400"
                            : "text-rose-400";
                          return (
                            <tr key={i} className={`border-b border-slate-800/50 transition-colors ${insufficient ? "opacity-50" : "hover:bg-slate-800/30"}`}>
                              <td className={`py-2 pr-4 font-semibold ${insufficient ? "text-muted-foreground" : "text-slate-200"}`}>{b.statType}</td>
                              <td className="py-2 pr-4 text-muted-foreground capitalize">{b.tier}</td>
                              <td className="py-2 pr-4 text-muted-foreground">{b.sport ?? "—"}</td>
                              <td className="py-2 px-2 text-right text-muted-foreground">
                                {b.sampleSize}
                                {insufficient && <span className="ml-1 text-[9px] text-amber-600 font-mono">/{10}</span>}
                              </td>
                              <td className={`py-2 px-2 text-right font-bold ${hitColor}`}>
                                {b.hitRate != null ? `${(b.hitRate * 100).toFixed(1)}%` : insufficient ? <span className="text-[10px] italic">need {10 - b.sampleSize} more</span> : "—"}
                              </td>
                              <td className="py-2 px-2 text-right text-muted-foreground">
                                {b.avgModelPOver != null ? `${b.avgModelPOver.toFixed(1)}%` : "—"}
                              </td>
                              <td className={`py-2 pl-2 text-right font-bold font-mono ${deltaColor}`}>
                                {b.delta != null ? `${b.delta > 0 ? "+" : ""}${b.delta.toFixed(1)}pp` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {insufficientBuckets.length > 0 && (
                      <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                        {insufficientBuckets.length} bucket{insufficientBuckets.length !== 1 ? "s" : ""} shown at reduced opacity — need ≥ 10 graded picks to unlock bias analysis.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Emotional State Performance */}
          {s.emotionWinRates && s.emotionWinRates.length > 0 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">Win Rate by Emotional State</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {(s.emotionWinRates as any[]).map((d: any) => (
                    <div key={d.emotion} className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <div className="text-xl mb-1">{EMOTION_EMOJI[d.emotion] ?? "🎯"}</div>
                      <div className="text-[10px] font-mono text-muted-foreground capitalize mb-1">{d.emotion}</div>
                      <div className={`text-lg font-bold font-mono ${(d.rate ?? 0) >= 0.6 ? "text-emerald-400" : (d.rate ?? 0) >= 0.5 ? "text-amber-400" : "text-rose-400"}`}>
                        {d.rate != null ? `${(d.rate * 100).toFixed(0)}%` : "—"}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">{d.wins}W / {d.total}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <div className="text-center text-muted-foreground font-mono py-20">Failed to load stats.</div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub: string; icon: any; color: string;
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between mb-2">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
          <Icon className={`w-3.5 h-3.5 ${color}`} />
        </div>
        <div className={`text-3xl font-bold font-mono ${color}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground font-mono mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
