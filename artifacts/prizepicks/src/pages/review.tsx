import { useGetReviewStats, getGetReviewStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Review() {
  const { data: stats, isLoading } = useGetReviewStats(undefined, {
    query: { queryKey: getGetReviewStatsQueryKey() }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Review Dashboard</h1>
      </div>

      {isLoading ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-48 bg-slate-900" />
            <Skeleton className="h-48 bg-slate-900" />
            <Skeleton className="h-48 bg-slate-900" />
          </div>
          <Skeleton className="h-96 bg-slate-900 w-full" />
        </>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total PnL</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-4xl font-bold font-mono ${stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}
                </div>
                <div className="text-sm text-muted-foreground mt-2 font-mono">Over {stats.totalEntries} entries</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Overall Hit Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold font-mono text-primary">
                  {stats.overallHitRate ? (stats.overallHitRate * 100).toFixed(1) : "—"}%
                </div>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Edge on Won vs Lost</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2 font-mono text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-emerald-400">Won Props:</span>
                    <span className="font-bold">
                      {((stats.avgScoresByResult as any)?.won?.edgeScore || 0).toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-rose-400">Lost Props:</span>
                    <span className="font-bold">
                      {((stats.avgScoresByResult as any)?.lost?.edgeScore || 0).toFixed(1)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle>Bankroll Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] w-full">
                {stats.bankrollCurve && stats.bankrollCurve.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.bankrollCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', color: '#f8fafc', fontFamily: 'monospace' }}
                        itemStyle={{ color: '#0ea5e9' }}
                      />
                      <Line type="monotone" dataKey="pnl" stroke="#0ea5e9" strokeWidth={2} dot={false} activeDot={{ r: 6, fill: '#0ea5e9' }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">Not enough data for chart</div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="text-center text-muted-foreground">Failed to load stats.</div>
      )}
    </div>
  );
}