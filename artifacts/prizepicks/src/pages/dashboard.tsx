import { useState } from "react";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PropDetailSheet } from "@/components/prop-detail-sheet";
import { AlertTriangle, Activity, Eye, Target, TrendingUp, Cpu, ShieldOff, BarChart2 } from "lucide-react";
import { LineTypeBadge, ActionTagBadge } from "@/components/ui/badges";

function StatCard({
  label, value, icon: Icon, iconClass, subLabel,
}: { label: string; value: React.ReactNode; icon: any; iconClass: string; subLabel?: string }) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${iconClass}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">{value}</div>
        {subLabel && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{subLabel}</div>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);

  const { data, isLoading } = useGetDashboardSummary({
    query: { queryKey: ["/api/dashboard/summary"] },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
        <div className="text-xs font-mono text-muted-foreground flex items-center gap-2" data-testid="status-live">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          LIVE DATA
        </div>
      </div>

      {isLoading || !data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 bg-slate-900" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="lg:col-span-2 h-96 bg-slate-900" />
            <Skeleton className="h-96 bg-slate-900" />
          </div>
        </>
      ) : (
        <>
          {/* KPI row — data */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Active Props"    value={data.activePropsCount}                           icon={Activity}      iconClass="text-primary"      />
            <StatCard label="Watched"         value={data.watchlistCount}                             icon={Eye}           iconClass="text-amber-500"    />
            <StatCard label="Pending Entries" value={data.pendingEntriesCount}                        icon={Target}        iconClass="text-fuchsia-500"  />
            <StatCard label="Avg Edge"        value={data.averageEdgeScore?.toFixed(1) ?? "—"}        icon={TrendingUp}    iconClass="text-emerald-500"  />
            <StatCard
              label="Unread Alerts"
              value={<span className="text-rose-500">{data.unreadAlertsCount}</span>}
              icon={AlertTriangle}
              iconClass="text-rose-500"
            />
          </div>

          {/* KPI row — model intelligence */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="PLAY Props"
              value={<span className="text-emerald-400">{(data as any).playPropsCount ?? "—"}</span>}
              icon={Cpu}
              iconClass="text-emerald-500"
              subLabel="model-rated actionable"
            />
            <StatCard
              label="Gated / NO-PLAY"
              value={<span className="text-rose-400">{(data as any).gatedPropsCount ?? "—"}</span>}
              icon={ShieldOff}
              iconClass="text-rose-500"
              subLabel="insufficient data quality"
            />
            <StatCard
              label="Avg P(Over)"
              value={(data as any).avgModelPOver != null ? `${(data as any).avgModelPOver}%` : "—"}
              icon={BarChart2}
              iconClass="text-sky-400"
              subLabel="across all qualified props"
            />
            <StatCard
              label="PLAY Avg P(Over)"
              value={(data as any).avgPlayPOver != null ? `${(data as any).avgPlayPOver}%` : "—"}
              icon={TrendingUp}
              iconClass="text-violet-400"
              subLabel="model confidence on PLAYs"
            />
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top props */}
            <Card className="lg:col-span-2 bg-slate-900 border-slate-800 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-mono uppercase tracking-wider">Top PLAY Props</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto space-y-2">
                {data.topPlayProps && data.topPlayProps.length > 0 ? (
                  data.topPlayProps.map((prop: any) => (
                    <div
                      key={prop.ppLineId}
                      onClick={() => setSelectedPropId(prop.ppLineId)}
                      className="flex items-center justify-between p-3 bg-slate-950 rounded border border-slate-800 cursor-pointer hover:bg-slate-800/70 hover:border-slate-700 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-bold truncate">{prop.playerName}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {prop.teamAbbr ?? "—"} vs {prop.opponentAbbr ?? "—"}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">•</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{prop.statType}</span>
                          {prop.lineType && prop.lineType !== "standard" && (
                            <LineTypeBadge type={prop.lineType} />
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4 flex items-center gap-4">
                        <div>
                          <div className="font-mono font-bold text-xl text-primary">{prop.lineValue}</div>
                          <div className="text-xs text-emerald-400 font-mono">Edge: {prop.edgeScore?.toFixed(1)}</div>
                        </div>
                        {prop.actionTag && <ActionTagBadge tag={prop.actionTag} />}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center h-32 text-muted-foreground font-mono text-sm">
                    No top play props available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right column */}
            <div className="space-y-6">
              {/* Injuries */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-mono uppercase tracking-wider">Recent Injuries</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.topInjuries && data.topInjuries.length > 0 ? (
                    data.topInjuries.map((injury: any) => (
                      <div
                        key={injury.id}
                        className="flex flex-col p-2 bg-slate-950 rounded border border-slate-800 border-l-2 border-l-rose-500"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-sm">{injury.playerName}</span>
                          <span className={`text-[10px] font-mono uppercase ${
                            injury.status === "out" ? "text-rose-400" :
                            injury.status === "gtd" ? "text-amber-400" :
                            injury.status === "questionable" ? "text-orange-400" :
                            "text-emerald-400"
                          }`}>{injury.status}</span>
                        </div>
                        <span className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{injury.note}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground font-mono">No recent injuries</div>
                  )}
                </CardContent>
              </Card>

              {/* Today's Games */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-mono uppercase tracking-wider">Today's Games</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.todaysGames && data.todaysGames.length > 0 ? (
                    data.todaysGames.map((game: any) => (
                      <div
                        key={game.id}
                        className="flex items-center justify-between text-sm font-mono p-2 bg-slate-950 rounded border border-slate-800"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-primary text-xs">{game.sport}</span>
                          <span>{game.awayTeamAbbr} @ {game.homeTeamAbbr}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-muted-foreground text-xs">
                            {new Date(game.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          {game.total && (
                            <div className="text-[10px] text-slate-500">O/U {game.total}</div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground font-mono">No games today</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <PropDetailSheet
        ppLineId={selectedPropId}
        open={!!selectedPropId}
        onOpenChange={open => !open && setSelectedPropId(null)}
      />
    </div>
  );
}
