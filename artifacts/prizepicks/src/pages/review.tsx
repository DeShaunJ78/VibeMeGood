import { useGetReviewStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Percent, DollarSign, Target, Brain } from "lucide-react";

const EMOTION_EMOJI: Record<string, string> = {
  confident: "💪", neutral: "😐", frustrated: "😤",
  excited: "🔥", anxious: "😰", unknown: "🎯",
};

export default function Review() {
  const { data: stats, isLoading } = useGetReviewStats(undefined, {
    query: { queryKey: ["review-stats"] }
  });

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
