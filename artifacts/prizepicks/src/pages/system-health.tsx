import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

async function triggerSync(action: string): Promise<void> {
  const map: Record<string, string> = {
    "pp-lines":       "/api/sync/prizepicks",
    "external-odds":  "/api/sync/external-odds",
    "projections":    "/api/sync/projections",
    "injuries":       "/api/sync/injuries",
    "variance":       "/api/sync/variance",
  };
  const path = map[action];
  if (!path) return;
  await fetch(`${BASE}${path}`, { method: "POST" });
}

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
          disabled={isFixing}
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

const QUICK_FIXES = [
  { label: "Sync PP Lines",    action: "pp-lines",      endpoint: "/api/sync/prizepicks" },
  { label: "Sync Odds",        action: "external-odds", endpoint: "/api/sync/external-odds" },
  { label: "Sync Projections", action: "projections",   endpoint: "/api/sync/projections" },
  { label: "Sync Injuries",    action: "injuries",      endpoint: "/api/sync/injuries" },
  { label: "Compute Variance", action: "variance",      endpoint: "/api/sync/variance" },
];

export default function SystemHealth() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixStatus, setFixStatus] = useState<Record<string, "running" | "done">>({});
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isFetching, refetch, dataUpdatedAt } = useQuery<HealthData>({
    queryKey: ["system-health"],
    queryFn: fetchHealth,
    enabled: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    refetch();
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
    setFixing(action);
    setFixStatus(s => ({ ...s, [action]: "running" }));
    await triggerSync(action);
    setFixStatus(s => ({ ...s, [action]: "done" }));
    setFixing(null);
    setTimeout(() => refetch(), 2000);
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

      <div className="border border-border/40 rounded-lg bg-slate-900/50 p-4">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Quick Fix</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_FIXES.map(f => {
            const st = fixStatus[f.action];
            return (
              <Button
                key={f.action}
                size="sm"
                variant="outline"
                className={cn(
                  "text-xs font-mono h-8 gap-1.5 border-border/50",
                  st === "running" && "opacity-60",
                  st === "done" && "border-emerald-700/50 text-emerald-400",
                )}
                onClick={() => handleFix(f.action)}
                disabled={!!fixing}
              >
                {st === "running" ? (
                  <><RefreshCw size={11} className="animate-spin" />{f.label}</>
                ) : st === "done" ? (
                  <><CheckCircle2 size={11} />{f.label}</>
                ) : (
                  <><Zap size={11} />{f.label}</>
                )}
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
