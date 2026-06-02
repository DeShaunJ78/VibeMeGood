import { useState } from "react";
import { useGetDataHealth, getGetDataHealthQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Database, Server, CheckCircle2, AlertCircle, Clock, Brain, FlaskConical, Lock, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useUserSettings, useUpdateUserSettings, type UserSettings } from "@/hooks/use-user-settings";

const SIGNAL_TOGGLES = [
  { key: "fatigue",     label: "Fatigue & Rest Modeling", desc: "Back-to-backs, distance, timezone shift" },
  { key: "environment", label: "Game Environment",        desc: "Blowout probability, spread, game total" },
  { key: "usage",       label: "Role & Usage Trends",     desc: "Minutes trend, usage spike / drop" },
  { key: "matchup",     label: "Matchup Depth",           desc: "Historical vs opponent, over rate" },
  { key: "narrative",   label: "Narrative Context",       desc: "Low weight — revenge, national TV, playoffs" },
  { key: "referee",     label: "Referee Modeling",        desc: "Foul rate, pace factor (requires opt-in)" },
];

const MODE_TOGGLES = [
  { key: "aggressiveWeighting", label: "Aggressive Variance Weighting", desc: "Doubles validated signal weights. High-risk." },
  { key: "stablePicksOnly",     label: "Stable Picks Mode",            desc: "Only show props with stable volatility rating." },
  { key: "ceilingHunterMode",   label: "Ceiling Hunter Mode",          desc: "Prioritize usage spikes and elevated environments." },
  { key: "excludeHighVolatility", label: "Exclude High Volatility",    desc: "Remove boom/bust and volatile props from optimizer." },
];

function VarianceIntelSection({ settings, onUpdate }: { settings: UserSettings; onUpdate: (patch: Partial<UserSettings>) => void }) {
  const [showExpLab, setShowExpLab] = useState(false);
  const signals = (settings.varianceSignals ?? {}) as Record<string, boolean>;
  const modes = (settings.varianceModes ?? {}) as Record<string, boolean>;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="w-4 h-4 text-primary" /> Variance Intelligence
        </CardTitle>
        <CardDescription>
          Contextual signals layered on top of every prop. When OFF, the app behaves exactly as before — no variance signals appear anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Master toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-700 rounded-lg">
          <div>
            <div className="font-semibold text-sm">Enable Variance Intelligence</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Adds fatigue, blowout risk, usage trends, and matchup depth to every prop.
            </div>
          </div>
          <Switch
            checked={settings.varianceIntelEnabled ?? false}
            onCheckedChange={v => onUpdate({ varianceIntelEnabled: v })}
          />
        </div>

        {settings.varianceIntelEnabled && (
          <div className="space-y-5 pl-4 border-l-2 border-primary/20">
            {/* Signal sub-toggles */}
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Active Signals</div>
              <div className="space-y-3">
                {SIGNAL_TOGGLES.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                    <Switch
                      checked={signals[key] ?? false}
                      onCheckedChange={v => onUpdate({ varianceSignals: { ...signals, [key]: v } as UserSettings["varianceSignals"] })}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Optimizer modes */}
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Optimizer Modes</div>
              <div className="space-y-3">
                {MODE_TOGGLES.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                    <Switch
                      checked={modes[key] ?? false}
                      onCheckedChange={v => onUpdate({ varianceModes: { ...modes, [key]: v } as UserSettings["varianceModes"] })}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Experimental Lab */}
            <div className="p-4 bg-amber-950/30 border border-amber-700/40 rounded-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" />
                    Experimental Signals Lab
                    <span className="text-[10px] font-mono bg-amber-900/50 text-amber-400 border border-amber-700/50 px-1.5 py-0.5 rounded uppercase tracking-widest">LAB</span>
                  </div>
                  <div className="text-xs text-amber-200/60 mt-1">
                    Birthday games, new shoes, haircut trends. Entertainment only. <strong className="text-amber-300">Never</strong> touches EV calculations.
                  </div>
                </div>
                <Switch
                  checked={settings.experimentalLabEnabled ?? false}
                  onCheckedChange={v => {
                    if (v && !settings.experimentalLabAcknowledged) {
                      setShowExpLab(true);
                    } else {
                      onUpdate({ experimentalLabEnabled: v });
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={showExpLab} onOpenChange={setShowExpLab}>
        <AlertDialogContent className="bg-slate-900 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-amber-300 flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> Experimental Signals Lab
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 space-y-2">
              <p>The Experimental Lab contains signals with <strong className="text-foreground">no statistical validation</strong>.</p>
              <p>These include: birthday games, new shoes, haircut patterns, social media activity.</p>
              <p><strong className="text-amber-300">These signals will NEVER influence EV calculations, optimizer recommendations, or probability scores.</strong></p>
              <p>Enable this if you want to track and explore unverified patterns for your own curiosity.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Off</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onUpdate({ experimentalLabEnabled: true, experimentalLabAcknowledged: true })}
              className="bg-amber-800 hover:bg-amber-700 text-amber-100"
            >
              I Understand — Enable Lab
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const SYNC_JOBS = [
  // PrizePicks lines are NOT server-syncable (PerimeterX 403s every server fetch).
  // Use the browser copy-paste import card below instead.
  { label: "Injury Reports",     endpoint: "/api/sync/injuries" },
  { label: "External Odds",      endpoint: "/api/sync/external-odds" },
  { label: "Player Projections", endpoint: "/api/sync/projections" },
  { label: "Game Scores",        endpoint: "/api/sync/scores" },
  { label: "Variance Compute",   endpoint: "/api/sync/variance" },
  { label: "Team Pace Ratings",  endpoint: "/api/admin/sync/pace" },
  { label: "Sync Games",         endpoint: "/api/sync/game-schedule" },
  { label: "Run Calibration",   endpoint: "/api/sync/calibration" },
  { label: "Backfill History",  endpoint: "/api/sync/historical-stats" },
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
  const [syncingPreLock, setSyncingPreLock] = useState(false);
  const [syncingJob, setSyncingJob] = useState<string | null>(null);
  const [ppPaste, setPpPaste] = useState("");
  const [ppImporting, setPpImporting] = useState<"idle" | "importing" | "done" | "error">("idle");
  const [ppDialogOpen, setPpDialogOpen] = useState(false);
  const { data: userSettings } = useUserSettings();
  const updateSettings = useUpdateUserSettings();

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

  const serverOrigin = window.location.origin;
  const importUrl = `${serverOrigin}/api/sync/pp-lines-import`;
  const ppApiUrl = "https://api.prizepicks.com/projections?per_page=25000&single_stat=true&include=new_player,league";

  // One-click sync bookmarklet: runs inside the user's logged-in prizepicks.com tab,
  // fetches the projections feed (same-site, cookies + PerimeterX pass), then POSTs
  // straight to our import endpoint (CORS is open). No copy-paste required.
  const bookmarklet =
    "javascript:(async()=>{try{const r=await fetch(" + JSON.stringify(ppApiUrl) +
    ",{credentials:'include'});if(!r.ok)throw new Error('PrizePicks returned '+r.status+' \\u2014 make sure you are logged in at prizepicks.com');" +
    "const j=await r.json();if(!j||!j.data||!j.included)throw new Error('That was not the projections feed.');" +
    "const p=await fetch(" + JSON.stringify(importUrl) +
    ",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:j.data,included:j.included})});" +
    "const o=await p.json().catch(()=>({}));if(!p.ok)throw new Error(o.error||('Import failed: '+p.status));" +
    "alert('\\u2713 PrizePicks synced: '+o.recordsProcessed+' lines imported into your Workstation.');}" +
    "catch(e){alert('PrizePicks sync failed: '+(e&&e.message?e.message:e));}})();";

  // React sanitizes javascript: hrefs, so set it via the DOM after mount so the
  // anchor remains draggable to the bookmarks bar.
  const setBookmarkletRef = (el: HTMLAnchorElement | null) => {
    if (el) el.setAttribute("href", bookmarklet);
  };

  async function importPpPaste() {
    setPpImporting("importing");
    try {
      let parsed: { data?: unknown[]; included?: unknown[] };
      try {
        parsed = JSON.parse(ppPaste);
      } catch {
        throw new Error("That isn't valid JSON. Make sure you copied the entire page (Ctrl+A then Ctrl+C).");
      }
      if (!Array.isArray(parsed?.data) || !Array.isArray(parsed?.included)) {
        throw new Error("This doesn't look like the PrizePicks feed — it should contain 'data' and 'included' arrays. You may have copied a login or block page.");
      }
      const res = await fetch(importUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: parsed.data, included: parsed.included }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Server returned ${res.status}`);
      }
      const result = await res.json() as { recordsProcessed: number };
      setPpImporting("done");
      setPpPaste("");
      toast({ title: "PrizePicks synced", description: `${result.recordsProcessed} lines imported.` });
      setTimeout(() => {
        setPpImporting("idle");
        qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
        refetch();
      }, 2500);
    } catch (e) {
      setPpImporting("error");
      toast({
        title: "Import failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setTimeout(() => setPpImporting("idle"), 5000);
    }
  }


  async function preLockSync() {
    setSyncingPreLock(true);
    try {
      await fetch("/api/sync/pre-lock", { method: "POST" });
      toast({ title: "Pre-lock sync started", description: "Lines, injuries, and odds refreshing now." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
        refetch();
      }, 2000);
    } catch {
      toast({ title: "Pre-lock sync failed", variant: "destructive" });
    } finally {
      setSyncingPreLock(false);
    }
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
            onClick={preLockSync}
            disabled={syncingPreLock || syncingAll}
            className="font-mono text-xs h-8 bg-amber-600 hover:bg-amber-500 text-white border-0"
          >
            <Lock className={`w-3 h-3 mr-1.5 ${syncingPreLock ? "animate-pulse" : ""}`} />
            {syncingPreLock ? "Syncing…" : "Pre-Lock Sync"}
          </Button>
          <Button
            size="sm"
            onClick={syncAll}
            disabled={syncingAll || syncingPreLock}
            className="font-mono text-xs h-8 bg-primary hover:bg-primary/90"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${syncingAll ? "animate-spin" : ""}`} />
            {syncingAll ? "Syncing…" : "Sync All"}
          </Button>
        </div>
      </div>

      {userSettings && (
        <VarianceIntelSection
          settings={userSettings}
          onUpdate={patch => updateSettings.mutate(patch)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Manual sync controls */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="w-4 h-4 text-primary" /> Data Sync
                </CardTitle>
                <CardDescription className="mt-1">Manually trigger individual data provider syncs</CardDescription>
              </div>
              <Button
                size="sm"
                onClick={syncAll}
                disabled={syncingAll}
                className="shrink-0 font-mono text-xs h-8 bg-primary hover:bg-primary/90"
              >
                <RefreshCw className={`w-3 h-3 mr-1.5 ${syncingAll ? "animate-spin" : ""}`} />
                {syncingAll ? "Syncing…" : "Sync All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* PrizePicks lines — browser sync (sits inline with the other sync buttons) */}
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-amber-500/30 rounded">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">PrizePicks Lines</span>
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">Browser</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPpDialogOpen(true)}
                className="h-7 font-mono text-xs border-amber-600/50 bg-amber-600/10 text-amber-300 hover:bg-amber-600/20"
              >
                <Zap className="w-3 h-3 mr-1" />
                Sync
              </Button>
            </div>

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
            <CardDescription>
              Live sync status — last 10 runs per provider
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-800" />)}
              </div>
            ) : data?.providers && data.providers.length > 0 ? (
              <div className="space-y-2">
                {data.providers.map((p: any, i: number) => {
                  const isError   = p.status === "error";
                  const isNever   = p.status === "never_run";
                  const isRunning = p.status === "running";
                  const rateOk    = p.recentSuccessRate === null || p.recentSuccessRate >= 0.5;
                  const degraded  = isError || !rateOk;

                  return (
                    <div
                      key={i}
                      className={`p-3 bg-slate-950 border rounded ${
                        degraded ? "border-red-500/40" : isRunning ? "border-amber-500/40" : "border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {degraded
                            ? <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                            : isRunning
                              ? <RefreshCw className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
                              : isNever
                                ? <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
                                : <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          }
                          <div>
                            <span className="font-bold font-mono text-sm block">
                              {p.label ?? p.name}
                            </span>
                            {p.lastSuccessAt && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                Last OK: {formatDistanceToNow(new Date(p.lastSuccessAt), { addSuffix: true })}
                                {p.recordsLastSync != null && ` · ${p.recordsLastSync} records`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.recentSuccessRate !== null && (
                            <span className={`text-[10px] font-mono ${
                              p.recentSuccessRate >= 0.8 ? "text-emerald-400"
                              : p.recentSuccessRate >= 0.5 ? "text-amber-400"
                              : "text-red-400"
                            }`}>
                              {Math.round(p.recentSuccessRate * 100)}%
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className={
                              degraded  ? "text-red-400 border-red-400/30 font-mono text-[10px]"
                              : isRunning ? "text-amber-400 border-amber-400/30 font-mono text-[10px]"
                              : isNever  ? "text-slate-500 border-slate-600 font-mono text-[10px]"
                              : "text-emerald-400 border-emerald-400/30 font-mono text-[10px]"
                            }
                          >
                            {isNever ? "NEVER RUN" : p.status?.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                      {degraded && p.lastError && (
                        <p className="text-[10px] text-red-400/80 font-mono mt-1.5 truncate">
                          {p.lastError}
                        </p>
                      )}
                    </div>
                  );
                })}
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
              <span className="font-mono text-sm text-muted-foreground">System Health</span>
              <Badge
                variant="outline"
                className={data?.systemHealthy
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 font-mono"
                  : "bg-red-500/10 text-red-400 border-red-500/40 font-mono"
                }
              >
                {data?.systemHealthy ? "HEALTHY" : "DEGRADED"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">Board Freshness</span>
              <span className={`font-mono text-sm font-bold ${
                data?.boardAgeHours == null ? "text-slate-500"
                : data.boardAgeHours < 1 ? "text-emerald-400"
                : data.boardAgeHours < 3 ? "text-amber-400"
                : "text-red-400"
              }`}>
                {data?.boardAgeHours != null
                  ? `${data.boardAgeHours}h ago`
                  : data?.boardFreshnessAt
                    ? formatDistanceToNow(new Date(data.boardFreshnessAt), { addSuffix: true })
                    : "—"}
              </span>
            </div>
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
              <span className="font-mono text-sm text-muted-foreground">Sync Log Entries</span>
              <span className="font-mono text-sm font-bold text-primary">{data?.lastPullLogs?.length ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PrizePicks sync dialog — one-click bookmarklet + paste fallback */}
      <Dialog open={ppDialogOpen} onOpenChange={setPpDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono flex items-center gap-2 text-amber-300">
              <Zap className="w-4 h-4" /> Sync PrizePicks Lines
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              PrizePicks blocks server-side fetches, so the sync runs from your own logged-in browser.
            </DialogDescription>
          </DialogHeader>

          {/* One-click bookmarklet */}
          <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="font-mono text-xs font-bold text-amber-400">One-click sync (recommended)</p>
            <ol className="text-[11px] text-muted-foreground space-y-2 list-none">
              <li className="flex gap-2">
                <span className="text-amber-500 font-mono shrink-0">1.</span>
                <span>
                  Drag this button to your browser&apos;s bookmarks bar (one-time setup):
                  <span className="block mt-2">
                    <a
                      ref={setBookmarkletRef}
                      href="#"
                      onClick={e => e.preventDefault()}
                      draggable
                      className="inline-flex items-center gap-1.5 cursor-grab rounded bg-amber-600 px-3 py-1.5 font-mono text-xs font-bold text-white no-underline hover:bg-amber-500"
                    >
                      <Zap className="w-3 h-3" /> PP → Workstation
                    </a>
                  </span>
                </span>
              </li>
              <li className="flex gap-2"><span className="text-amber-500 font-mono shrink-0">2.</span><span>Open and log in at <span className="font-mono text-slate-300">app.prizepicks.com</span>.</span></li>
              <li className="flex gap-2"><span className="text-amber-500 font-mono shrink-0">3.</span><span>Click the bookmark. Lines import automatically — no copy-paste. Re-click any time to refresh.</span></li>
            </ol>
          </div>

          {/* Manual paste fallback */}
          <div className="space-y-3 rounded border border-slate-700 bg-slate-950 p-3">
            <p className="font-mono text-xs font-bold text-slate-300">Manual paste (fallback)</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              If the bookmark is blocked, <a href={ppApiUrl} target="_blank" rel="noreferrer" className="text-amber-300 underline hover:text-amber-200">open the PP data feed →</a>, select all (Ctrl+A), copy (Ctrl+C), paste below, then Import.
            </p>
            <textarea
              value={ppPaste}
              onChange={e => setPpPaste(e.target.value)}
              placeholder="Paste the PrizePicks JSON here…"
              spellCheck={false}
              className="w-full h-24 rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[10px] text-slate-300 resize-y focus:outline-none focus:border-amber-500/50"
            />
            <Button
              size="sm"
              onClick={importPpPaste}
              disabled={ppImporting === "importing" || ppPaste.trim().length === 0}
              className="h-8 font-mono text-xs bg-amber-600 hover:bg-amber-500 text-white border-0"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${ppImporting === "importing" ? "animate-spin" : ""}`} />
              {ppImporting === "importing" ? "Importing…" :
               ppImporting === "done"      ? "Done ✓" :
               "Import Pasted Lines"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
