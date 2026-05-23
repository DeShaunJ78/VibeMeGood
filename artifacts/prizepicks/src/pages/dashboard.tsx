import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Activity, Watch, Target, TrendingUp, CheckCircle2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { data, isLoading } = useGetDashboardSummary({
    query: {
      queryKey: ["/api/dashboard/summary"] // using a generic key since helper isn't explicitly exported for this one without params sometimes, but wait I can use getGetDashboardSummaryQueryKey. Let's use the explicit hook.
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
        <div className="text-xs font-mono text-muted-foreground flex items-center gap-2" data-testid="status-live">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          LIVE DATA
        </div>
      </div>

      {isLoading || !data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-32 bg-slate-900" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="lg:col-span-2 h-96 bg-slate-900" />
            <Skeleton className="h-96 bg-slate-900" />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Props</CardTitle>
                <Activity className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{data.activePropsCount}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Watched</CardTitle>
                <Watch className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{data.watchlistCount}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Pending Entries</CardTitle>
                <Target className="h-4 w-4 text-fuchsia-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{data.pendingEntriesCount}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Edge</CardTitle>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{data.averageEdgeScore?.toFixed(1) || "—"}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Unread Alerts</CardTitle>
                <AlertTriangle className="h-4 w-4 text-rose-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-rose-500">{data.unreadAlertsCount}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 bg-slate-900 border-slate-800 flex flex-col">
              <CardHeader>
                <CardTitle className="text-lg">Top PLAY Props</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto">
                {data.topPlayProps && data.topPlayProps.length > 0 ? (
                  <div className="space-y-4">
                    {data.topPlayProps.map(prop => (
                      <div key={prop.ppLineId} className="flex items-center justify-between p-3 bg-slate-950 rounded border border-slate-800">
                        <div>
                          <div className="font-bold">{prop.playerName}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-1">{prop.teamAbbr} vs {prop.opponentAbbr} • {prop.statType}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold text-lg text-primary">{prop.lineValue}</div>
                          <div className="text-xs text-emerald-500 font-mono mt-1">Edge: {prop.edgeScore?.toFixed(1)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">No top play props available</div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-lg">Recent Injuries</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.topInjuries && data.topInjuries.length > 0 ? (
                    <div className="space-y-3">
                      {data.topInjuries.map(injury => (
                        <div key={injury.id} className="flex flex-col p-2 bg-slate-950 rounded border border-slate-800 border-l-2 border-l-rose-500">
                          <div className="flex justify-between">
                            <span className="font-bold text-sm">{injury.playerName}</span>
                            <span className="text-xs font-mono text-rose-400">{injury.status}</span>
                          </div>
                          <span className="text-xs text-muted-foreground mt-1 line-clamp-1">{injury.note}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No recent injuries</div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-lg">Today's Games</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.todaysGames && data.todaysGames.length > 0 ? (
                    <div className="space-y-2">
                      {data.todaysGames.map(game => (
                        <div key={game.id} className="flex items-center justify-between text-sm font-mono p-2 bg-slate-950 rounded border border-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="text-primary">{game.sport}</span>
                            <span>{game.awayTeamAbbr} @ {game.homeTeamAbbr}</span>
                          </div>
                          <span className="text-muted-foreground">{new Date(game.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No games today</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
