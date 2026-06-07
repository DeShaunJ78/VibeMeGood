import { useState, useEffect } from "react";
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
    description: "Rerun the model — updates edge, risk, and action tags.",
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

interface Toast {
  id: number;
  label: string;
  ok: boolean;
  msg: string;
}

let toastSeq = 0;

export default function QuickSync() {
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);

  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  function addToast(label: string, ok: boolean, msg: string) {
    const id = ++toastSeq;
    setToasts(t => [...t, { id, label, ok, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }

  async function trigger(job: SyncJob) {
    setStatuses(s => ({ ...s, [job.id]: "loading" }));
    setErrors(e => ({ ...e, [job.id]: "" }));
    try {
      const res = await fetch(`${base}${job.endpoint}`, { method: "POST" });
      if (res.ok) {
        setStatuses(s => ({ ...s, [job.id]: "success" }));
        addToast(job.label, true, "Running in background — check Slate in ~30 sec");
        setTimeout(() => setStatuses(s => ({ ...s, [job.id]: "idle" })), 6000);
      } else {
        const text = await res.text().catch(() => "");
        setStatuses(s => ({ ...s, [job.id]: "error" }));
        setErrors(e => ({ ...e, [job.id]: text || `HTTP ${res.status}` }));
        addToast(job.label, false, text || `HTTP ${res.status}`);
      }
    } catch {
      setStatuses(s => ({ ...s, [job.id]: "error" }));
      setErrors(e => ({ ...e, [job.id]: "Network error — is the server up?" }));
      addToast(job.label, false, "Network error — is the server up?");
    }
  }

  async function triggerAll() {
    const primary = JOBS.filter(j => j.primary);
    await Promise.all(primary.map(trigger));
  }

  const anyLoading = Object.values(statuses).some(s => s === "loading");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 space-y-5 max-w-lg mx-auto">

      {/* Toast stack — fixed at bottom so it doesn't move the page */}
      <div className="fixed bottom-6 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`w-full max-w-lg rounded-2xl px-5 py-4 shadow-2xl flex items-start gap-3 animate-in slide-in-from-bottom-4 duration-300 pointer-events-auto ${
              t.ok
                ? "bg-emerald-500 text-white"
                : "bg-rose-600 text-white"
            }`}
          >
            {t.ok
              ? <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
              : <XCircle className="w-6 h-6 shrink-0 mt-0.5" />
            }
            <div>
              <p className="font-mono font-bold text-sm">{t.ok ? `✓ ${t.label} started` : `✗ ${t.label} failed`}</p>
              <p className="font-mono text-xs opacity-90 mt-0.5">{t.msg}</p>
            </div>
          </div>
        ))}
      </div>

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
          <span className="font-bold">PP board import</span> requires the Chrome extension on desktop. Everything below runs on the server and works from any device.
        </p>
      </div>

      {/* Big primary button */}
      <button
        onClick={triggerAll}
        disabled={anyLoading}
        className="w-full py-5 rounded-2xl bg-primary/20 border-2 border-primary/40 text-primary font-mono font-bold text-base uppercase tracking-wider active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-3"
      >
        {anyLoading
          ? <><Loader2 className="w-5 h-5 animate-spin" /> Running…</>
          : <><RefreshCw className="w-5 h-5" /> Rescore + Refresh Projections</>
        }
      </button>

      {/* Individual job cards */}
      <div className="space-y-3">
        {JOBS.map(job => {
          const status = statuses[job.id] ?? "idle";
          const err = errors[job.id];
          const Icon = job.icon;
          const isSuccess = status === "success";
          const isError = status === "error";
          const isLoading = status === "loading";

          return (
            <button
              key={job.id}
              onClick={() => trigger(job)}
              disabled={isLoading}
              className={`w-full text-left rounded-2xl border px-4 py-4 transition-all duration-300 active:scale-[0.98] disabled:active:scale-100 ${
                isSuccess
                  ? "bg-emerald-500/20 border-emerald-400/60"
                  : isError
                  ? "bg-rose-500/20 border-rose-500/60"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Icon box */}
                <div className={`rounded-xl p-2.5 shrink-0 transition-colors duration-300 ${
                  isSuccess ? "bg-emerald-500/30" : isError ? "bg-rose-500/30" : "bg-slate-800"
                }`}>
                  {isLoading
                    ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    : isSuccess
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                    : isError
                    ? <XCircle className="w-5 h-5 text-rose-300" />
                    : <Icon className={`w-5 h-5 ${job.iconClass}`} />
                  }
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-mono font-bold text-sm transition-colors duration-300 ${
                      isSuccess ? "text-emerald-200" : isError ? "text-rose-200" : "text-slate-100"
                    }`}>
                      {isSuccess ? `✓ ${job.label} started` : isError ? `✗ ${job.label} failed` : job.label}
                    </span>
                    {job.costsCreditNote && !isSuccess && !isError && (
                      <span className="text-[9px] font-mono text-amber-400/70 border border-amber-500/30 rounded px-1 py-0.5 uppercase tracking-wide">
                        {job.costsCreditNote}
                      </span>
                    )}
                  </div>
                  <p className={`text-[11px] font-mono mt-0.5 leading-relaxed transition-colors duration-300 ${
                    isSuccess ? "text-emerald-400/80" : isError ? "text-rose-400/80" : "text-slate-500"
                  }`}>
                    {isSuccess
                      ? "Running in background — check Slate in ~30 sec"
                      : isError
                      ? (err || "Something went wrong")
                      : job.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-[10px] font-mono text-slate-700 pb-20">
        Bookmark this page on your phone for one-tap access
      </p>
    </div>
  );
}
