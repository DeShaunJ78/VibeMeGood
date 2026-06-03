import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDashboardSummary,
  useListAlerts, getListAlertsQueryKey,
  useMarkAlertRead, useMarkAllAlertsRead, useClearReadAlerts,
  useClearAllAlerts, useDeleteAlert,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropDetailSheet } from "@/components/prop-detail-sheet";
import {
  AlertTriangle, Activity, Eye, Target, TrendingUp, Cpu, ShieldOff, BarChart2,
  BellOff, CheckCheck, Trash2, X, ChevronRight,
} from "lucide-react";
import { LineTypeBadge, ActionTagBadge, POverBadge, DQBadge } from "@/components/ui/badges";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";
import { EmptyState } from "@/components/empty-state";

function StatCard({
  label, value, icon: Icon, iconClass, subLabel, onClick,
}: {
  label: string; value: React.ReactNode; icon: any; iconClass: string;
  subLabel?: string; onClick?: () => void;
}) {
  return (
    <Card
      className={`bg-slate-900 border-slate-800 ${onClick ? "cursor-pointer hover:bg-slate-800/70 hover:border-slate-700 active:bg-slate-800 transition-colors" : ""}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className="flex items-center gap-1">
          <Icon className={`h-4 w-4 ${iconClass}`} />
          {onClick && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">{value}</div>
        {subLabel && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{subLabel}</div>}
      </CardContent>
    </Card>
  );
}

const SEVERITY_BORDER: Record<string, string> = {
  warning: "border-amber-700/60 bg-amber-900/10",
  error:   "border-rose-700/60 bg-rose-900/10",
  info:    "border-slate-700 bg-slate-900/40",
};

const ALERT_TYPE_ICON: Record<string, string> = {
  injury_update:     "🏥",
  line_move:         "📊",
  lineup_confirmed:  "✅",
  sync_success:      "🔄",
  stale_data:        "⏰",
  model_flag:        "🤖",
  value_alert:       "💡",
};

function AlertsPanel({
  open, onClose, unreadCount,
}: { open: boolean; onClose: () => void; unreadCount: number }) {
  const qc = useQueryClient();
  const { data: alerts, isLoading } = useListAlerts(undefined, {
    query: { enabled: open, queryKey: getListAlertsQueryKey() },
  });
  const markOne   = useMarkAlertRead();
  const markAll   = useMarkAllAlertsRead();
  const clearRead = useClearReadAlerts();
  const clearAll  = useClearAllAlerts();
  const deleteOne = useDeleteAlert();

  const summaryKey = ["/api/dashboard/summary"];

  async function handleMarkAll() {
    await markAll.mutateAsync();
    await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    await qc.invalidateQueries({ queryKey: summaryKey });
  }

  async function handleMarkOne(id: number) {
    await markOne.mutateAsync({ id });
    await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    await qc.invalidateQueries({ queryKey: summaryKey });
  }

  async function handleClearRead() {
    await clearRead.mutateAsync();
    await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    await qc.invalidateQueries({ queryKey: summaryKey });
  }

  async function handleClearAll() {
    await clearAll.mutateAsync();
    await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    await qc.invalidateQueries({ queryKey: summaryKey });
  }

  async function handleDeleteOne(id: number) {
    await deleteOne.mutateAsync({ id });
    await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    await qc.invalidateQueries({ queryKey: summaryKey });
  }

  const hasRead = alerts?.some((a: any) => a.isRead);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 max-w-lg max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <DialogTitle className="font-mono text-sm uppercase tracking-wider">Alerts</DialogTitle>
            {unreadCount > 0 && (
              <span className="text-[10px] font-mono bg-rose-900/50 text-rose-400 border border-rose-800/60 px-1.5 py-0.5 rounded">
                {unreadCount} unread
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                size="sm" variant="outline" onClick={handleMarkAll}
                disabled={markAll.isPending}
                className="font-mono text-xs h-7 border-slate-700 text-slate-300 gap-1.5"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </Button>
            )}
            {hasRead && (
              <Button
                size="sm" variant="outline" onClick={handleClearRead}
                disabled={clearRead.isPending}
                className="font-mono text-xs h-7 border-slate-700 text-slate-400 hover:text-rose-400 hover:border-rose-800/60 gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Clear read
              </Button>
            )}
            {alerts && alerts.length > 0 && (
              <Button
                size="sm" variant="outline" onClick={handleClearAll}
                disabled={clearAll.isPending}
                className="font-mono text-xs h-7 border-rose-900/60 text-rose-400 hover:bg-rose-900/20 gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Clear all
              </Button>
            )}
          </div>
        </DialogHeader>
        <div className="overflow-auto flex-1 p-4 space-y-2">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-slate-800" />
            ))
          ) : !alerts?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <BellOff className="w-8 h-8 mb-2 opacity-40" />
              <p className="font-mono text-sm">No alerts</p>
            </div>
          ) : (
            alerts.map((a: any) => (
              <div
                key={a.id}
                className={`flex items-start gap-3 p-3 border rounded-lg transition-opacity ${
                  a.isRead ? "opacity-40" : ""
                } ${SEVERITY_BORDER[a.severity] ?? SEVERITY_BORDER.info}`}
              >
                <span className="text-lg shrink-0 mt-0.5 leading-none">
                  {ALERT_TYPE_ICON[a.type] ?? "🔔"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{a.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{a.message}</div>
                  <div className="text-[10px] font-mono text-slate-600 mt-1">
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                </div>
                {!a.isRead && (
                  <Button
                    size="icon" variant="ghost" onClick={() => handleMarkOne(a.id)}
                    disabled={markOne.isPending}
                    className="h-6 w-6 shrink-0 text-slate-500 hover:text-emerald-400"
                    title="Mark as read"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  size="icon" variant="ghost" onClick={() => handleDeleteOne(a.id)}
                  disabled={deleteOne.isPending}
                  className="h-6 w-6 shrink-0 text-slate-600 hover:text-rose-400"
                  title="Delete alert"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [, navigate] = useLocation();

  const { data, isLoading } = useGetDashboardSummary({
    query: { queryKey: ["/api/dashboard/summary"] },
  });

  const topProjProps: any[] = (data as any)?.topProjProps ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
        {data && !isLoading ? (
          <DataFreshnessBadge
            activePropsCount={data.activePropsCount}
            linesUpdatedAtMs={(data as { dataFreshness?: { ppLines?: number | null } }).dataFreshness?.ppLines ?? null}
          />
        ) : (
          <div className="h-5 w-24 rounded bg-slate-800 animate-pulse" aria-hidden />
        )}
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
          {data.activePropsCount === 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm font-mono text-amber-200/90">
              <span>
                No synced props in the last 24 hours. Run <strong className="text-amber-100">Settings → Sync All</strong> or dev seed (<code className="text-[11px] bg-slate-900/80 px-1 rounded">seed:dev</code>).
              </span>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-amber-700/50 text-amber-200 hover:bg-amber-900/30"
                onClick={() => navigate("/settings")}
              >
                Open Settings
              </Button>
            </div>
          )}

          {/* KPI row — data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              label="Active Props"
              value={data.activePropsCount}
              icon={Activity}
              iconClass="text-primary"
              subLabel="total lines on the board"
              onClick={() => navigate("/slate")}
            />
            <StatCard
              label="Watched"
              value={data.watchlistCount}
              icon={Eye}
              iconClass="text-amber-500"
              subLabel="props you're tracking"
              onClick={() => navigate("/slate")}
            />
            <StatCard
              label="Pending Entries"
              value={data.pendingEntriesCount}
              icon={Target}
              iconClass="text-fuchsia-500"
              subLabel="slips awaiting results"
              onClick={() => navigate("/journal")}
            />
            <StatCard
              label="Avg Edge"
              value={data.averageEdgeScore?.toFixed(1) ?? "—"}
              icon={TrendingUp}
              iconClass="text-emerald-500"
              subLabel="model edge across all props"
              onClick={() => navigate("/review")}
            />
            <StatCard
              label="Unread Alerts"
              value={<span className="text-rose-500">{data.unreadAlertsCount}</span>}
              icon={AlertTriangle}
              iconClass="text-rose-500"
              subLabel="tap to view"
              onClick={() => setAlertsOpen(true)}
            />
          </div>

          {/* KPI row — model intelligence */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="PLAY Props"
              value={<span className="text-emerald-400">{(data as any).playPropsCount ?? "—"}</span>}
              icon={Cpu}
              iconClass="text-emerald-500"
              subLabel="props our model recommends"
              onClick={() => navigate("/slate")}
            />
            <StatCard
              label="Gated / NO-PLAY"
              value={<span className="text-rose-400">{(data as any).gatedPropsCount ?? "—"}</span>}
              icon={ShieldOff}
              iconClass="text-rose-500"
              subLabel="props we can't rate yet"
              onClick={() => navigate("/slate")}
            />
            <StatCard
              label="Avg P(Over)"
              value={(data as any).avgModelPOver != null ? `${(data as any).avgModelPOver}%` : "—"}
              icon={BarChart2}
              iconClass="text-sky-400"
              subLabel="model confidence, all props"
              onClick={() => navigate("/review")}
            />
            <StatCard
              label="PLAY Avg P(Over)"
              value={(data as any).avgPlayPOver != null ? `${(data as any).avgPlayPOver}%` : "—"}
              icon={TrendingUp}
              iconClass="text-violet-400"
              subLabel="confidence on PLAYs only"
              onClick={() => navigate("/review")}
            />
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top props by model edge */}
            <Card className="lg:col-span-2 bg-slate-900 border-slate-800 flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-mono uppercase tracking-wider">Top Picks by Model Edge</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground bg-slate-800 px-2 py-0.5 rounded">
                      sorted by P(Over)
                    </span>
                    <button
                      onClick={() => navigate("/slate")}
                      className="text-[10px] font-mono text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5"
                    >
                      View all <ChevronRight className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto space-y-2">
                {topProjProps.length > 0 ? (
                  topProjProps.map((prop: any) => (
                    <div
                      key={prop.ppLineId}
                      onClick={() => setSelectedPropId(prop.ppLineId)}
                      className="flex items-center justify-between p-3 bg-slate-950 rounded border border-slate-800 cursor-pointer hover:bg-slate-800/70 hover:border-slate-700 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold truncate">{prop.playerName}</span>
                          {prop.isGated && (
                            <span className="text-[9px] font-mono uppercase tracking-wider bg-rose-900/40 text-rose-400 border border-rose-800/50 px-1 py-0.5 rounded">
                              GATED
                            </span>
                          )}
                        </div>
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
                      <div className="text-right shrink-0 ml-4 flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-mono font-bold text-xl text-primary">{prop.lineValue}</div>
                          {prop.edgeScore != null && (
                            <div className="text-[10px] text-slate-400 font-mono">Edge: {prop.edgeScore.toFixed(1)}</div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {prop.pOver != null && <POverBadge pOver={prop.pOver} />}
                          {prop.actionTag && <ActionTagBadge tag={prop.actionTag} />}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    className="h-40"
                    title={
                      data.activePropsCount === 0
                        ? "No active lines on the board"
                        : "No top picks for today's games"
                    }
                    description={
                      data.activePropsCount === 0
                        ? "Lines need a recent PrizePicks sync (last 24h). After syncing, PLAY props and model top picks will appear here."
                        : "Props are loaded but none qualify for today's slate window, or all are gated NO-PLAY. Check Slates or run Sync All."
                    }
                    action={
                      <Button size="sm" variant="secondary" onClick={() => navigate("/slate")}>
                        Open Slates
                      </Button>
                    }
                  />
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

      <AlertsPanel
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        unreadCount={(data as any)?.unreadAlertsCount ?? 0}
      />
    </div>
  );
}
