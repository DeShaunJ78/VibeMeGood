import { useState } from "react";
import { useGetDataHealth, getGetDataHealthQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Database, Server, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SYNC_JOBS = [
  { label: "PrizePicks Lines",   endpoint: "/api/sync/pp-lines" },
  { label: "Injury Reports",     endpoint: "/api/sync/injuries" },
  { label: "External Odds",      endpoint: "/api/sync/external-odds" },
  { label: "Player Projections", endpoint: "/api/sync/projections" },
  { label: "Game Scores",        endpoint: "/api/sync/scores" },
];

function StatusDot({ status }: { status: string }) {
  if (status === "success") return <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />;
  if (status === "error")   return <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />;
  if (status === "running") return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-slate-600 inline-block" />;
}

export default function Settings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingJob, setSyncingJob] = useState<string | null>(null);

  const { data, isLoading, refetch } = useGetDataHealth({
    query: { queryKey: getGetDataHealthQueryKey() },
  });

  async function triggerSync(endpoint: string, label: string) {
    setSyncingJob(endpoint);
    try {
      const r = await fetch(endpoint, { method: "POST" });
      if (!r.ok) throw new Error();
      toast({ title: `Sync started`, description: `${label} sync initiated.` });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
        refetch();
      }, 1500);
    } catch {
      toast({ title: "Sync failed", description: `Could not start ${label} sync.`, variant: "destructive" });
    } finally {
      setSyncingJob(null);
    }
  }

  async function syncAll() {
    setSyncingAll(true);
    for (const job of SYNC_JOBS) {
      try {
        await fetch(job.endpoint, { method: "POST" });
        await new Promise(r => setTimeout(r, 200));
      } catch { /* continue */ }
    }
    toast({ title: "All syncs started", description: "All data providers refreshed." });
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
      refetch();
    }, 2000);
    setSyncingAll(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings & Data Health</h1>
        <div className="flex items-center gap-3">
          {data && (
            <Badge
              variant="outline"
              className={data.mode === "live"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 font-mono"
                : "bg-amber-500/10 text-amber-400 border-amber-500/40 font-mono"
              }
            >
              {data.mode.toUpperCase()} MODE
            </Badge>
          )}
          <Button
            size="sm"
            onClick={syncAll}
            disabled={syncingAll}
            className="font-mono text-xs h-8 bg-primary hover:bg-primary/90"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${syncingAll ? "animate-spin" : ""}`} />
            {syncingAll ? "Syncing…" : "Sync All"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Manual sync controls */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="w-4 h-4 text-primary" /> Data Sync
            </CardTitle>
            <CardDescription>Manually trigger individual data provider syncs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {SYNC_JOBS.map(job => (
              <div
                key={job.endpoint}
                className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded"
              >
                <span className="font-mono text-sm">{job.label}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => triggerSync(job.endpoint, job.label)}
                  disabled={syncingJob === job.endpoint || syncingAll}
                  className="h-7 font-mono text-xs border-slate-700 bg-slate-800 hover:bg-slate-700"
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${syncingJob === job.endpoint ? "animate-spin" : ""}`} />
                  {syncingJob === job.endpoint ? "Running" : "Sync"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent sync logs */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="w-4 h-4 text-primary" /> Recent Sync Logs
            </CardTitle>
            <CardDescription>Latest automated data pull results</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-800" />)}
              </div>
            ) : data?.lastPullLogs && data.lastPullLogs.length > 0 ? (
              <div className="space-y-2">
                {data.lastPullLogs.map((log: any) => (
                  <div key={log.id} className="flex flex-col p-3 bg-slate-950 border border-slate-800 rounded gap-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusDot status={log.status} />
                        <span className="font-bold text-sm font-mono">{log.jobName}</span>
                      </div>
                      <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                        log.status === "success" ? "bg-emerald-500/10 text-emerald-400" :
                        log.status === "error"   ? "bg-rose-500/10 text-rose-400" :
                        log.status === "running" ? "bg-amber-500/10 text-amber-400" :
                        "bg-slate-800 text-slate-400"
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                      <span>{log.recordsProcessed ?? 0} records</span>
                      <span>{formatDistanceToNow(new Date(log.startedAt), { addSuffix: true })}</span>
                    </div>
                    {log.errorMessage && (
                      <div className="text-[10px] text-rose-400 font-mono bg-rose-900/20 px-2 py-1 rounded">
                        {log.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground font-mono">No sync logs found.</div>
            )}
          </CardContent>
        </Card>

        {/* Data providers */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4 text-primary" /> Data Providers
            </CardTitle>
            <CardDescription>Status of upstream API connections</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 bg-slate-800" />)}
              </div>
            ) : data?.providers && data.providers.length > 0 ? (
              <div className="space-y-2">
                {data.providers.map((p: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="font-bold font-mono text-sm">{p.name ?? "Unknown Provider"}</span>
                    </div>
                    <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 font-mono text-[10px]">
                      HEALTHY
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground font-mono">No providers listed.</div>
            )}
          </CardContent>
        </Card>

        {/* Mode info card */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" /> System Info
            </CardTitle>
            <CardDescription>Runtime environment and data mode</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">Data Mode</span>
              <Badge
                variant="outline"
                className={data?.mode === "live"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 font-mono"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/40 font-mono"
                }
              >
                {data?.mode?.toUpperCase() ?? "UNKNOWN"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">Data Providers</span>
              <span className="font-mono text-sm font-bold text-primary">{data?.providers?.length ?? 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">Sync Log Entries</span>
              <span className="font-mono text-sm font-bold text-primary">{data?.lastPullLogs?.length ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
