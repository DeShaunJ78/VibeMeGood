import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, Zap,
  Database, Wifi, Activity, Clock, Play,
} from "lucide-react";

type CheckStatus = "green" | "amber" | "red";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  lastUpdated: string | null;
  fixAction: string | null;
}

interface HealthData {
  runAt: string;
  durationMs: number;
  overall: CheckStatus;
  sections: {
    dataFreshness: CheckResult[];
    databaseHealth: CheckResult[];
    apiConnectivity: CheckResult[];
    featureStatus: CheckResult[];
  };
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchHealth(): Promise<HealthData> {
  const res = await fetch(`${BASE}/api/system-health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function triggerSync(action: string): Promise<Response | null> {
  const map: Record<string, string> = {
    "external-odds":        "/api/sync/external-odds",
    "rescore-props":        "/api/sync/rescore-props",
    "projections":          "/api/sync/projections",
    "injuries":             "/api/sync/injuries",
    "variance":             "/api/sync/variance",
    "pace":                 "/api/admin/sync/pace",
    "sharp":                "/api/sharp/compute",
    "nfl-advanced":         "/api/admin/sync/nfl-advanced",
    "calibration":          "/api/sync/calibration",
    "historical-stats":     "/api/sync/historical-stats",
    "backfill-game-ids":    "/api/sync/backfill-game-ids",
    "matchup-history":      "/api/sync/matchup-history",
    "game-logs":            "/api/sync/game-logs",
    "game-schedule":        "/api/sync/game-schedule",
    "game-schedule-history":"/api/sync/game-schedule-history",
  };
  const path = map[action];
  if (!path) return null;
  return fetch(`${BASE}${path}`, { method: "POST" });
}

// Maps a Fix action to the jobName the server broadcasts on the `sync_status`
// SSE channel when the job actually finishes. This lets us resolve the right
// button the moment *its* job completes instead of guessing with a fixed delay.
// Actions not listed are synchronous (resolve from the HTTP response) or fall
// back to a safety timeout.
const JOB_NAME_BY_ACTION: Record<string, string> = {
  "external-odds":        "external-odds",
  "rescore-props":        "rescore-props",
  "projections":          "projections",
  "injuries":             "sync-injuries",
  "variance":             "variance",
  "game-schedule":        "game-schedule",
  "matchup-history":      "matchup-history",
  "backfill-game-ids":    "backfill-game-ids",
  "game-logs":            "game-logs",
  "game-schedule-history":"game-schedule-history",
  "historical-stats":     "historical-stats",
  "calibration":          "calibration",
  "nfl-advanced":         "nfl-advanced-metrics",
  "sharp":                "sharp",
};

function StatusIcon({ status, size = 16 }: { status: CheckStatus; size?: number }) {
  if (status === "green")  return <CheckCircle2  size={size} className="text-emerald-400 shrink-0" />;
  if (status === "amber")  return <AlertTriangle size={size} className="text-amber-400 shrink-0" />;
  return <XCircle size={size} className="text-red-400 shrink-0" />;
}

function StatusBadge({ status }: { status: CheckStatus }) {
  return (
    <Badge className={cn(
      "text-[10px] font-mono font-bold px-2 py-0.5 border rounded",
      status === "green" && "bg-emerald-950/60 text-emerald-300 border-emerald-700/50",
      status === "amber" && "bg-amber-950/60 text-amber-300 border-amber-700/50",
      status === "red"   && "bg-red-950/60 text-red-300 border-red-700/50",
    )}>
      {status === "green" ? "GREEN" : status === "amber" ? "AMBER" : "RED"}
    </Badge>
  );
}

function CheckRow({ check, onFix, fixing }: { check: CheckResult; onFix: (a: string) => void; fixing: string | null }) {
  const isFixing = fixing === check.fixAction;
  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-0",
      "hover:bg-slate-800/20 transition-colors",
    )}>
      <StatusIcon status={check.status} size={15} />
      <span className="font-mono text-sm text-foreground flex-1 min-w-0">{check.name}</span>
      <StatusBadge status={check.status} />
      <span className="text-xs text-muted-foreground flex-1 min-w-0 hidden md:block truncate">{check.detail}</span>
      {check.lastUpdated && (
        <span className="text-[10px] text-muted-foreground/60 font-mono whitespace-nowrap hidden lg:block">
          {new Date(check.lastUpdated).toLocaleTimeString()}
        </span>
      )}
      {check.fixAction && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] font-mono px-2 border-red-800/50 text-red-400 hover:bg-red-950/40 shrink-0"
          onClick={() => onFix(check.fixAction!)}
          disabled={fixing !== null}
        >
          {isFixing ? <RefreshCw size={10} className="animate-spin" /> : "Fix"}
        </Button>
      )}
    </div>
  );
}

function Section({
  title, icon: Icon, checks, onFix, fixing,
}: {
  title: string;
  icon: React.ElementType;
  checks: CheckResult[];
  onFix: (a: string) => void;
  fixing: string | null;
}) {
  const hasRed   = checks.some(c => c.status === "red");
  const hasAmber = checks.some(c => c.status === "amber");
  const sectionStatus: CheckStatus = hasRed ? "red" : hasAmber ? "amber" : "green";

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-slate-900/50">
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border/40",
        sectionStatus === "green" && "bg-emerald-950/20",
        sectionStatus === "amber" && "bg-amber-950/20",
        sectionStatus === "red"   && "bg-red-950/20",
      )}>
        <Icon size={14} className={cn(
          sectionStatus === "green" && "text-emerald-400",
          sectionStatus === "amber" && "text-amber-400",
          sectionStatus === "red"   && "text-red-400",
        )} />
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground font-semibold">{title}</span>
        <div className="ml-auto flex gap-1">
          {["green","amber","red"].map(s => {
            const n = checks.filter(c => c.status === s).length;
            if (!n) return null;
            return (
              <span key={s} className={cn(
                "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                s === "green" && "bg-emerald-900/40 text-emerald-400",
                s === "amber" && "bg-amber-900/40 text-amber-400",
                s === "red"   && "bg-red-900/40 text-red-400",
              )}>{n}</span>
            );
          })}
        </div>
      </div>
      <div>
        {checks.map(c => (
          <CheckRow key={c.name} check={c} onFix={onFix} fixing={fixing} />
        ))}
      </div>
    </div>
  );
}

interface PipelineStep {
  step: number;
  label: string;
  action: string;
  description: string;
  isBrowserOnly?: boolean;
  isLong?: boolean;
}

const PIPELINE_STEPS: PipelineStep[] = [
  { step: 1, label: "Sync Schedule",     action: "game-schedule",    description: "Seeds the games table with today's matchups and team context." },
  { step: 2, label: "Backfill History",  action: "historical-stats", description: "Downloads all NBA/MLB/NHL/NFL game logs. First run takes 15–30 min.", isLong: true },
  { step: 3, label: "Compute Matchups",  action: "matchup-history",  description: "Builds head-to-head history so the model adjusts for tough/soft matchups." },
  { step: 4, label: "Sync Projections",  action: "projections",      description: "Runs Bayesian + distribution math (Poisson/NegBin/ZIP) on all active lines." },
  { step: 5, label: "Run Calibration",   action: "calibration",      description: "Rebuilds probability buckets from historical logs. Requires Backfill first." },
  { step: 6, label: "Rescore Props",     action: "rescore-props",    description: "Recalculates edge/action/PLAY scores. Free — no API call, no credits used." },
];

const UTILITY_STEPS = [
  { label: "Sync Injuries",      action: "injuries" },
  { label: "Sync Game Logs",     action: "game-logs" },
  { label: "NFL Advanced",       action: "nfl-advanced" },
  { label: "Sync Pace",          action: "pace" },
  { label: "Sync Sharp",         action: "sharp" },
  { label: "Backfill Game IDs",  action: "backfill-game-ids" },
  { label: "Schedule History",   action: "game-schedule-history" },
];

export default function SystemHealth() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixStatus, setFixStatus] = useState<Record<string, "running" | "done" | "error">>({});
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isFetching, refetch, dataUpdatedAt } = useQuery<HealthData>({
    queryKey: ["system-health"],
    queryFn: fetchHealth,
    enabled: false,
    staleTime: Infinity,
  });

  // The in-flight "Fix". Syncs run async on the server (the POST returns
  // "started" instantly, then the job works for seconds/minutes), so we resolve
  // the button when its job's `sync_status` completion event arrives over SSE —
  // never with a fixed delay. Refs keep the SSE handler stable across renders.
  const pendingFix = useRef<{
    action: string;
    jobName: string | null;
    label: string;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const settleFix = (ok: boolean) => {
    const p = pendingFix.current;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    pendingFix.current = null;
    setFixStatus(s => ({ ...s, [p.action]: ok ? "done" : "error" }));
    setFixing(null);
    toastRef.current(ok
      ? { title: "Sync complete", description: `${p.label} finished successfully` }
      : { title: "Sync failed", description: `${p.label} returned an error — check server logs`, variant: "destructive" });
    refetchRef.current();
  };
  const settleFixRef = useRef(settleFix);
  settleFixRef.current = settleFix;

  // Safety-timeout path. We have NO proof of completion (the SSE event never
  // arrived), so we must not claim success or failure — that's exactly the
  // false-green that caused this bug. Clear the spinner to a neutral state and
  // refetch; the real freshness state comes from the health check itself.
  const fixTimedOut = () => {
    const p = pendingFix.current;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    pendingFix.current = null;
    setFixing(null);
    setFixStatus(s => {
      const next = { ...s };
      delete next[p.action];
      return next;
    });
    toastRef.current({
      title: "Still working",
      description: `${p.label} is taking longer than expected — this row updates automatically when it finishes.`,
    });
    refetchRef.current();
  };
  const fixTimedOutRef = useRef(fixTimedOut);
  fixTimedOutRef.current = fixTimedOut;

  useEffect(() => {
    refetch();
  }, []);

  // Live job completion — auto-reconnecting SSE so a network blip doesn't
  // leave buttons spinning forever. Exponential backoff up to 30s.
  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    let es: EventSource;
    let retryMs = 1000;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const handler = (e: Event) => {
      let d: { job?: string; status?: string };
      try { d = JSON.parse((e as MessageEvent).data); } catch { return; }
      if (d.status !== "success" && d.status !== "error") return;
      refetchRef.current();
      const p = pendingFix.current;
      if (p && p.jobName !== null && p.jobName === d.job) {
        settleFixRef.current(d.status === "success");
      }
    };

    function connect() {
      es = new EventSource(`${base}/api/events`);
      es.addEventListener("sync_status", handler);
      es.addEventListener("open", () => { retryMs = 1000; });
      es.addEventListener("error", () => {
        es.close();
        if (!cancelled) {
          retryTimer = setTimeout(() => {
            retryMs = Math.min(retryMs * 2, 30000);
            connect();
          }, retryMs);
        }
      });
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es.close();
      if (pendingFix.current?.timer) clearTimeout(pendingFix.current.timer);
    };
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(() => refetch(), 5 * 60 * 1000);
    } else {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [autoRefresh, refetch]);

  const handleFix = async (action: string) => {
    const allSteps = [...PIPELINE_STEPS, ...UTILITY_STEPS];
    const label = allSteps.find(s => s.action === action)?.label ?? action;
    if (pendingFix.current?.timer) clearTimeout(pendingFix.current.timer);
    pendingFix.current = { action, jobName: JOB_NAME_BY_ACTION[action] ?? null, label, timer: null };
    setFixing(action);
    setFixStatus(s => ({ ...s, [action]: "running" }));

    try {
      const res = await triggerSync(action);
      // Unknown action (no route mapping) — nothing ran; never fake a success.
      if (!res) { settleFix(false); return; }
      if (!res.ok) { settleFix(false); return; }

      // Synchronous routes (e.g. pace, sharp) return their result directly and
      // are already done. Async routes return { status: "started" } and finish
      // later — wait for their `sync_status` SSE event (with a safety timeout).
      const body = await res.json().catch(() => null) as { status?: string } | null;
      const started = body?.status === "started";
      if (!started) { settleFix(true); return; }

      // Safety net: if a completion event never arrives, stop spinning after
      // 4 min and re-check the real state anyway. (Already settled? no-op.)
      if (pendingFix.current && pendingFix.current.action === action) {
        pendingFix.current.timer = setTimeout(() => fixTimedOutRef.current(), 240000);
      }
    } catch {
      settleFix(false);
    }
  };

  const overall = data?.overall;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
            <Zap size={22} className="text-yellow-400" />
            System Status
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Full diagnostic — all checks run in parallel
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={cn(
              "flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded border transition-colors",
              autoRefresh
                ? "bg-emerald-950/40 border-emerald-700/50 text-emerald-400"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            )}
          >
            <Clock size={11} />
            Auto-refresh {autoRefresh ? "ON" : "OFF"}
          </button>
          <Button
            onClick={() => refetch()}
            disabled={isFetching}
            className="font-mono text-sm gap-2"
          >
            {isFetching
              ? <><RefreshCw size={14} className="animate-spin" /> Running checks…</>
              : <><Play size={14} /> Run Health Check</>
            }
          </Button>
        </div>
      </div>

      {data && (
        <div className={cn(
          "flex items-center gap-4 px-5 py-4 rounded-lg border font-mono",
          overall === "green" && "bg-emerald-950/30 border-emerald-700/50",
          overall === "amber" && "bg-amber-950/30 border-amber-700/50",
          overall === "red"   && "bg-red-950/30 border-red-700/50",
        )}>
          <StatusIcon status={overall!} size={22} />
          <div>
            <p className={cn(
              "text-base font-bold",
              overall === "green" && "text-emerald-300",
              overall === "amber" && "text-amber-300",
              overall === "red"   && "text-red-300",
            )}>
              {overall === "green" && "ALL SYSTEMS GREEN ✅ — Ready to play"}
              {overall === "amber" && "WARNINGS DETECTED ⚠️ — Check amber items"}
              {overall === "red"   && "ISSUES FOUND ❌ — Fix red items before playing"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Completed in {data.durationMs}ms · {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : ""}
            </p>
          </div>
        </div>
      )}

      {/* ── Data Pipeline ── */}
      <div className="border border-border/40 rounded-lg bg-slate-900/50 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-slate-800/40">
          <Zap size={13} className="text-yellow-400" />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground font-semibold">Data Pipeline</span>
          <span className="text-[10px] text-muted-foreground/60 font-mono ml-auto">Run steps in order for a fresh setup</span>
        </div>
        <div className="divide-y divide-border/20">
          {PIPELINE_STEPS.map(step => {
            const st = fixStatus[step.action];
            const isRunning = fixing === step.action;
            return (
              <div key={step.step} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/20 transition-colors">
                <span className={cn(
                  "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono",
                  st === "done"
                    ? "bg-emerald-900/60 text-emerald-400 border border-emerald-700/50"
                    : "bg-slate-800 text-muted-foreground border border-border/50",
                )}>{step.step}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-foreground">{step.label}</span>
                    {step.isLong && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/30">15–30 MIN</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 font-mono mt-0.5 truncate">{step.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "shrink-0 h-7 text-[11px] font-mono px-3 gap-1.5 border-border/50",
                    isRunning   && "opacity-60",
                    st === "done"  && "border-emerald-700/50 text-emerald-400",
                    st === "error" && "border-red-700/50 text-red-400",
                  )}
                  onClick={() => handleFix(step.action)}
                  disabled={!!fixing}
                >
                  {isRunning ? <RefreshCw size={10} className="animate-spin" />
                    : st === "done"  ? <CheckCircle2 size={10} />
                    : st === "error" ? <XCircle size={10} />
                    : <Zap size={10} />}
                  {isRunning ? "Running…" : st === "done" ? "Done" : st === "error" ? "Error" : "Run"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Utilities ── */}
      <div className="border border-border/40 rounded-lg bg-slate-900/50 p-4">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Utilities — run as needed</p>
        <div className="flex flex-wrap gap-2">
          {UTILITY_STEPS.map(u => {
            const st = fixStatus[u.action];
            const isRunning = fixing === u.action;
            return (
              <Button
                key={u.action}
                size="sm"
                variant="outline"
                className={cn(
                  "text-xs font-mono h-8 gap-1.5 border-border/50",
                  isRunning    && "opacity-60",
                  st === "done"  && "border-emerald-700/50 text-emerald-400",
                  st === "error" && "border-red-700/50 text-red-400",
                )}
                onClick={() => handleFix(u.action)}
                disabled={!!fixing}
              >
                {isRunning ? <RefreshCw size={11} className="animate-spin" />
                  : st === "done"  ? <CheckCircle2 size={11} />
                  : st === "error" ? <XCircle size={11} />
                  : <Zap size={11} />}
                {u.label}
              </Button>
            );
          })}
        </div>
      </div>

      {!data && !isFetching && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Activity size={36} className="opacity-30" />
          <p className="font-mono text-sm">Click <strong>Run Health Check</strong> to diagnose all systems</p>
        </div>
      )}

      {isFetching && !data && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <RefreshCw size={36} className="animate-spin opacity-40" />
          <p className="font-mono text-sm">Running {"> "}20 checks in parallel…</p>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <Section
            title="Data Freshness"
            icon={Clock}
            checks={data.sections.dataFreshness}
            onFix={handleFix}
            fixing={fixing}
          />
          <Section
            title="Database Health"
            icon={Database}
            checks={data.sections.databaseHealth}
            onFix={handleFix}
            fixing={fixing}
          />
          <Section
            title="API Connectivity"
            icon={Wifi}
            checks={data.sections.apiConnectivity}
            onFix={handleFix}
            fixing={fixing}
          />
          <Section
            title="Feature Status"
            icon={Activity}
            checks={data.sections.featureStatus}
            onFix={handleFix}
            fixing={fixing}
          />
        </div>
      )}
    </div>
  );
}
