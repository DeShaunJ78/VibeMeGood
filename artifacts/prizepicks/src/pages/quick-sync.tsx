import { useState } from "react";
import { RefreshCw, Cpu, TrendingUp, AlertTriangle, HeartPulse, ClipboardCheck, CheckCircle2, XCircle, Loader2, Smartphone } from "lucide-react";

type SyncStatus = "idle" | "loading" | "success" | "error";

interface SyncJob {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  icon: React.ElementType;
  iconClass: string;
  costsCreditNote?: string;
  primary?: boolean;
}

const JOBS: SyncJob[] = [
  {
    id: "rescore",
    label: "Rescore Props",
    description: "Rerun the model on existing lines — updates edge, risk, and action tags. Free & fast.",
    endpoint: "/api/sync/rescore-props",
    icon: Cpu,
    iconClass: "text-primary",
    primary: true,
  },
  {
    id: "projections",
    label: "Refresh Projections",
    description: "Recompute stat projections from game logs and priors.",
    endpoint: "/api/sync/projections",
    icon: TrendingUp,
    iconClass: "text-emerald-400",
    primary: true,
  },
  {
    id: "injuries",
    label: "Sync Injuries",
    description: "Pull the latest injury and lineup news.",
    endpoint: "/api/sync/injuries",
    icon: HeartPulse,
    iconClass: "text-rose-400",
  },
  {
    id: "odds",
    label: "Sync Market Odds",
    description: "Fetch live market lines from the Odds API.",
    endpoint: "/api/sync/external-odds",
    icon: RefreshCw,
    iconClass: "text-amber-400",
    costsCreditNote: "Uses Odds API credits",
  },
  {
    id: "autograde",
    label: "Auto-grade Picks",
    description: "Match open picks against game logs and grade them.",
    endpoint: "/api/sync/auto-grade-picks",
    icon: ClipboardCheck,
    iconClass: "text-sky-400",
  },
];

function StatusIcon({ status }: { status: SyncStatus }) {
  if (status === "loading") return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;
  if (status === "success") return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
  if (status === "error") return <XCircle className="w-5 h-5 text-rose-400" />;
  return null;
}

export default function QuickSync() {
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});

  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  async function trigger(job: SyncJob) {
    setStatuses(s => ({ ...s, [job.id]: "loading" }));
    setMessages(m => ({ ...m, [job.id]: "" }));
    try {
      const res = await fetch(`${base}${job.endpoint}`, { method: "POST" });
      if (res.ok) {
        setStatuses(s => ({ ...s, [job.id]: "success" }));
        setMessages(m => ({ ...m, [job.id]: "Done" }));
        setTimeout(() => setStatuses(s => ({ ...s, [job.id]: "idle" })), 4000);
      } else {
        const text = await res.text().catch(() => "");
        setStatuses(s => ({ ...s, [job.id]: "error" }));
        setMessages(m => ({ ...m, [job.id]: text || `HTTP ${res.status}` }));
      }
    } catch {
      setStatuses(s => ({ ...s, [job.id]: "error" }));
      setMessages(m => ({ ...m, [job.id]: "Network error" }));
    }
  }

  async function triggerAll() {
    const primary = JOBS.filter(j => j.primary);
    await Promise.all(primary.map(trigger));
  }

  const anyLoading = Object.values(statuses).some(s => s === "loading");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 space-y-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <Smartphone className="w-6 h-6 text-primary shrink-0" />
        <div>
          <h1 className="text-lg font-mono font-bold uppercase tracking-wider">Quick Sync</h1>
          <p className="text-xs text-muted-foreground font-mono">Trigger server-side updates from any device</p>
        </div>
      </div>

      {/* PP import notice */}
      <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs font-mono text-amber-300 leading-relaxed">
          <span className="font-bold">PP board import</span> requires the Chrome extension on desktop — that step still needs your computer. Everything below runs on the server and works from any device.
        </p>
      </div>

      {/* Quick-fire primary actions */}
      <button
        onClick={triggerAll}
        disabled={anyLoading}
        className="w-full py-5 rounded-2xl bg-primary/20 border-2 border-primary/40 text-primary font-mono font-bold text-base uppercase tracking-wider active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-3"
      >
        {anyLoading
          ? <Loader2 className="w-5 h-5 animate-spin" />
          : <RefreshCw className="w-5 h-5" />
        }
        Rescore + Refresh Projections
      </button>

      {/* Individual job cards */}
      <div className="space-y-3">
        {JOBS.map(job => {
          const status = statuses[job.id] ?? "idle";
          const msg = messages[job.id];
          const Icon = job.icon;
          return (
            <button
              key={job.id}
              onClick={() => trigger(job)}
              disabled={status === "loading"}
              className={`w-full text-left rounded-2xl border px-4 py-4 transition-all active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 ${
                status === "success"
                  ? "bg-emerald-950/40 border-emerald-700/50"
                  : status === "error"
                  ? "bg-rose-950/40 border-rose-700/50"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-xl p-2.5 bg-slate-800 shrink-0`}>
                  <Icon className={`w-5 h-5 ${job.iconClass}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-slate-100">{job.label}</span>
                    {job.costsCreditNote && (
                      <span className="text-[9px] font-mono text-amber-400/70 border border-amber-500/30 rounded px-1 py-0.5 uppercase tracking-wide">
                        {job.costsCreditNote}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 mt-0.5 leading-relaxed">{job.description}</p>
                  {msg && (
                    <p className={`text-[11px] font-mono mt-1 ${status === "error" ? "text-rose-400" : "text-emerald-400"}`}>
                      {msg}
                    </p>
                  )}
                </div>
                <div className="shrink-0 ml-1">
                  <StatusIcon status={status} />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-[10px] font-mono text-slate-700 pb-4">
        Bookmark this page on your phone's home screen for one-tap access
      </p>
    </div>
  );
}
