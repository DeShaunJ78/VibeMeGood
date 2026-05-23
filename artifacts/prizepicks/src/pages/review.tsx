import { useGetReviewStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Percent, DollarSign } from "lucide-react";

export default function Review() {
  const { data: stats, isLoading } = useGetReviewStats(undefined, {
    query: { queryKey: ["review-stats"] }
  });

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
        </div>
      ) : stats ? (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total P&L"
              value={`${stats.totalPnl >= 0 ? "+" : ""}$${Number(stats.totalPnl).toFixed(2)}`}
              sub={`${stats.totalEntries} entries`}
              icon={DollarSign}
              color={stats.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
            <StatCard
              label="Entry Hit Rate"
              value={stats.overallHitRate != null ? `${(stats.overallHitRate * 100).toFixed(1)}%` : "—"}
              sub="wins / total"
              icon={Percent}
              color="text-primary"
            />
            <StatCard
              label="Pick Hit Rate"
              value={stats.pickHitRate != null ? `${(Number(stats.pickHitRate) * 100).toFixed(1)}%` : "—"}
              sub="individual legs"
              icon={TrendingUp}
              color="text-emerald-400"
            />
            <StatCard
              label="Avg CLV"
              value={stats.avgClv != null ? `${Number(stats.avgClv) > 0 ? "+" : ""}${Number(stats.avgClv).toFixed(2)}` : "—"}
              sub="closing line value"
              icon={stats.avgClv != null && Number(stats.avgClv) >= 0 ? TrendingUp : TrendingDown}
              color={stats.avgClv != null && Number(stats.avgClv) >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
          </div>

          {/* Bankroll Curve */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">Bankroll Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                {stats.bankrollCurve && stats.bankrollCurve.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.bankrollCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", color: "#f8fafc", fontFamily: "monospace", fontSize: 11 }}
                        formatter={(v: any) => [`$${v}`, "Balance"]}
                      />
                      <Line type="monotone" dataKey="balance" stroke="#0ea5e9" strokeWidth={2} dot={{ fill: "#0ea5e9", r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm font-mono">Not enough data for chart</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Hit Rate Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">By Pick Count</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries((stats.hitRateByPickCount as Record<string, any>) ?? {}).map(([count, data]) => (
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

            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">By Entry Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries((stats.hitRateByEntryType as Record<string, any>) ?? {}).map(([type, data]) => (
                    <div key={type} className="bg-slate-800/50 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-mono font-bold uppercase">{type}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{data.wins} wins / {data.total} entries</div>
                      </div>
                      <div className={`text-xl font-bold font-mono ${(data.rate ?? 0) >= 0.5 ? "text-emerald-400" : "text-rose-400"}`}>
                        {data.rate != null ? `${(data.rate * 100).toFixed(0)}%` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <div className="text-center text-muted-foreground font-mono py-20">Failed to load stats.</div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub: string; icon: any; color: string }) {
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
