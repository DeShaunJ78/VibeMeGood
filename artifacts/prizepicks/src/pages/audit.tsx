import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuditLatest,
  getGetAuditLatestQueryKey,
  useRunAudit,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Microscope,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

// ── colour helpers ───────────────────────────────────────────────────────────

function brierColor(v: number) {
  if (v < 0.15) return "text-emerald-400";
  if (v < 0.20) return "text-green-400";
  if (v < 0.23) return "text-yellow-400";
  if (v < 0.26) return "text-orange-400";
  return "text-red-400";
}

function eceColor(v: number) {
  if (v < 0.03) return "text-emerald-400";
  if (v < 0.06) return "text-green-400";
  if (v < 0.10) return "text-yellow-400";
  return "text-red-400";
}

function maxCalColor(v: number) {
  if (v < 0.20) return "text-emerald-400";
  if (v < 0.35) return "text-yellow-400";
  if (v < 0.55) return "text-orange-400";
  return "text-red-400";
}

function chrColor(v: number) {
  if (v > 0.80) return "text-emerald-400";
  if (v > 0.72) return "text-green-400";
  if (v > 0.65) return "text-yellow-400";
  return "text-orange-400";
}

function deltaColor(d: number) {
  if (d > 0.0005)  return "text-emerald-400";
  if (d < -0.0005) return "text-red-400";
  return "text-slate-400";
}

function DeltaIcon({ d }: { d: number }) {
  if (d > 0.0005)  return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  if (d < -0.0005) return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-slate-400" />;
}

function pct(v: number, decimals = 1) {
  return `${(v * 100).toFixed(decimals)}%`;
}

// ── metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, color, sub,
}: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className={cn("text-2xl font-mono font-bold", color)}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{sub}</div>}
    </div>
  );
}

// ── sort hook ────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function useSort<T extends Record<string, unknown>>(initial: keyof T) {
  const [key, setKey] = useState<keyof T>(initial);
  const [dir, setDir] = useState<SortDir>("desc");

  function toggle(k: keyof T) {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setKey(k); setDir("desc"); }
  }

  function sort(rows: T[]) {
    return [...rows].sort((a, b) => {
      const av = a[key] as number | string;
      const bv = b[key] as number | string;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return dir === "asc" ? cmp : -cmp;
    });
  }

  function SortIcon({ col }: { col: keyof T }) {
    if (col !== key) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return dir === "asc"
      ? <ChevronUp className="w-3 h-3 text-primary" />
      : <ChevronDown className="w-3 h-3 text-primary" />;
  }

  return { sort, toggle, SortIcon };
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ModelAudit() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useGetAuditLatest();
  const runMutation = useRunAudit({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetAuditLatestQueryKey() });
      },
    },
  });

  const statSort  = useSort<Record<string, unknown>>("brier");
  const sportSort = useSort<Record<string, unknown>>("brier");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground font-mono text-sm">
        Loading audit data…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <Microscope className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-lg font-mono font-semibold">Model Audit</h1>
        </div>
        <div className="border border-border/50 bg-slate-900/60 rounded p-6 text-center space-y-4">
          <div className="text-muted-foreground font-mono text-sm">No backtest results yet.</div>
          <div className="text-muted-foreground font-mono text-xs">
            Run the audit to generate per-stat, per-sport, per-factor, and edge-bucket breakdowns.
          </div>
          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="font-mono"
          >
            {runMutation.isPending && <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />}
            Run Audit (~45s)
          </Button>
        </div>
      </div>
    );
  }

  const { summary, perStat, perSport, perFactor, perEdgeBucket, calibrationBuckets } = data;
  const b = summary.base;
  const runAt = new Date(data.runAt).toLocaleString();

  const sortedStats  = statSort.sort(perStat as unknown as Record<string, unknown>[]);
  const sortedSports = sportSort.sort(perSport as unknown as Record<string, unknown>[]);

  return (
    <div className="p-6 space-y-8 max-w-[1400px]">

      {/* ── header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Microscope className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-lg font-mono font-semibold">Model Audit</h1>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground">
            {data.series} series · {data.predictions.toLocaleString()} predictions · last run {runAt}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="font-mono text-xs shrink-0"
        >
          {runMutation.isPending
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Running…</>
            : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Run Audit</>}
        </Button>
      </div>

      {/* ── Tier 0: overview ── */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Overview — base model
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <MetricCard label="Brier" value={b.brier.toFixed(4)} color={brierColor(b.brier)}
            sub="lower = sharper" />
          <MetricCard label="Conf Hit Rate" value={pct(b.confHitRate)}
            color={chrColor(b.confHitRate)}
            sub={`n=${b.confidentN.toLocaleString()} |p−0.5|≥0.10`} />
          <MetricCard label="ECE" value={pct(b.ece)}
            color={eceColor(b.ece)} sub="avg calibration gap" />
          <MetricCard label="Max Cal Error" value={pct(b.maxCalError)}
            color={maxCalColor(b.maxCalError)} sub="worst bucket gap" />
        </div>
        {/* calibration table */}
        <div className="border border-border/50 rounded overflow-hidden">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-border/50 bg-slate-900/80">
                <th className="px-3 py-2 text-left text-muted-foreground font-normal">Bucket</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">n</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Predicted</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Actual</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Gap</th>
              </tr>
            </thead>
            <tbody>
              {calibrationBuckets.map((cb) => (
                <tr key={cb.bucket} className="border-b border-border/20 hover:bg-slate-800/30">
                  <td className="px-3 py-1.5">{cb.bucket}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{cb.n.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{pct(cb.predicted)}</td>
                  <td className="px-3 py-1.5 text-right">{pct(cb.actual)}</td>
                  <td className={cn("px-3 py-1.5 text-right",
                    Math.abs(cb.gap) < 0.02 ? "text-emerald-400" :
                    Math.abs(cb.gap) < 0.05 ? "text-yellow-400" :
                    Math.abs(cb.gap) < 0.10 ? "text-orange-400" : "text-red-400"
                  )}>
                    {cb.gap >= 0 ? "+" : ""}{pct(cb.gap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Tier 1: factor audit ── */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Tier 1 — Factor Audit
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mb-3">
          Per-factor marginal lift on rows where that factor applied (solo ablation, base model vs base+factor).
          Positive delta = factor improves Brier. Negative = hurts.
        </p>
        <div className="border border-border/50 rounded overflow-hidden">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-border/50 bg-slate-900/80">
                <th className="px-3 py-2 text-left text-muted-foreground font-normal">Factor</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Rows</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Base Brier</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">+Factor Brier</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Delta</th>
                <th className="px-3 py-2 text-left text-muted-foreground font-normal">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {perFactor.map((f) => (
                <tr key={f.factor} className="border-b border-border/20 hover:bg-slate-800/30">
                  <td className="px-3 py-1.5 text-foreground">{f.factor}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{f.rows.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{f.baseBrier.toFixed(4)}</td>
                  <td className="px-3 py-1.5 text-right">{f.adjBrier.toFixed(4)}</td>
                  <td className={cn("px-3 py-1.5 text-right font-semibold", deltaColor(f.delta))}>
                    <span className="flex items-center justify-end gap-1">
                      <DeltaIcon d={f.delta} />
                      {f.delta >= 0 ? "+" : ""}{f.delta.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {f.delta > 0.0005
                      ? <span className="text-emerald-400 font-mono">KEEP</span>
                      : f.delta < -0.0005
                      ? <span className="text-red-400 font-mono">REMOVE</span>
                      : <span className="text-slate-500 font-mono">NEUTRAL</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground font-mono mt-2">
          Note: pace, dvp, impliedTotal, weather, nflAdvanced not evaluable from game logs alone.
        </p>
      </section>

      {/* ── Tier 2: stat audit ── */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Tier 2 — Stat Audit
        </h2>
        <div className="border border-border/50 rounded overflow-hidden">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-border/50 bg-slate-900/80">
                {([
                  { key: "statType", label: "Stat Type",  align: "left" },
                  { key: "n",        label: "n",          align: "right" },
                  { key: "brier",    label: "Brier",      align: "right" },
                  { key: "confHitRate", label: "Conf HR", align: "right" },
                  { key: "ece",      label: "ECE",        align: "right" },
                  { key: "maxCalError", label: "MaxCal",  align: "right" },
                ] as const).map(({ key, label, align }) => (
                  <th
                    key={key}
                    onClick={() => statSort.toggle(key)}
                    className={cn(
                      "px-3 py-2 text-muted-foreground font-normal cursor-pointer hover:text-foreground select-none",
                      align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      <statSort.SortIcon col={key} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedStats.map((s) => {
                const row = s as unknown as typeof perStat[number];
                return (
                  <tr key={row.statType} className="border-b border-border/20 hover:bg-slate-800/30">
                    <td className="px-3 py-1.5 text-foreground">{row.statType}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{row.n.toLocaleString()}</td>
                    <td className={cn("px-3 py-1.5 text-right font-semibold", brierColor(row.brier))}>
                      {row.brier.toFixed(4)}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right", chrColor(row.confHitRate))}>
                      {pct(row.confHitRate)}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right", eceColor(row.ece))}>
                      {pct(row.ece)}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right", maxCalColor(row.maxCalError))}>
                      {pct(row.maxCalError)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Tier 3: sport audit ── */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Tier 3 — Sport Audit
        </h2>
        {sortedSports.length === 0 ? (
          <div className="text-[11px] text-muted-foreground font-mono">
            No sport data (player sport JOIN returned no results).
          </div>
        ) : (
          <div className="border border-border/50 rounded overflow-hidden">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="border-b border-border/50 bg-slate-900/80">
                  {([
                    { key: "sport",       label: "Sport",   align: "left" },
                    { key: "n",           label: "n",       align: "right" },
                    { key: "brier",       label: "Brier",   align: "right" },
                    { key: "confHitRate", label: "Conf HR", align: "right" },
                    { key: "ece",         label: "ECE",     align: "right" },
                    { key: "maxCalError", label: "MaxCal",  align: "right" },
                  ] as const).map(({ key, label, align }) => (
                    <th
                      key={key}
                      onClick={() => sportSort.toggle(key)}
                      className={cn(
                        "px-3 py-2 text-muted-foreground font-normal cursor-pointer hover:text-foreground select-none",
                        align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <sportSort.SortIcon col={key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedSports.map((s) => {
                  const row = s as unknown as typeof perSport[number];
                  return (
                    <tr key={row.sport} className="border-b border-border/20 hover:bg-slate-800/30">
                      <td className="px-3 py-2 text-foreground font-semibold">{row.sport}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{row.n.toLocaleString()}</td>
                      <td className={cn("px-3 py-2 text-right font-semibold", brierColor(row.brier))}>
                        {row.brier.toFixed(4)}
                      </td>
                      <td className={cn("px-3 py-2 text-right", chrColor(row.confHitRate))}>
                        {pct(row.confHitRate)}
                      </td>
                      <td className={cn("px-3 py-2 text-right", eceColor(row.ece))}>
                        {pct(row.ece)}
                      </td>
                      <td className={cn("px-3 py-2 text-right", maxCalColor(row.maxCalError))}>
                        {pct(row.maxCalError)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Tier 4: edge audit ── */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Tier 4 — Edge Audit
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mb-3">
          Grouped by displayed edge (|pOver − 50%|). If the model is honest,
          hit rate should increase monotonically with edge.
        </p>
        <div className="border border-border/50 rounded overflow-hidden">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-border/50 bg-slate-900/80">
                <th className="px-3 py-2 text-left text-muted-foreground font-normal">Edge bucket</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">n</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Avg predicted</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Actual hit rate</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-normal">Gap</th>
                <th className="px-3 py-2 text-left text-muted-foreground font-normal">Signal</th>
              </tr>
            </thead>
            <tbody>
              {perEdgeBucket.map((e, i) => {
                const gap = e.actualHitRate - e.avgPredicted;
                const prevHr = i > 0 ? perEdgeBucket[i - 1].actualHitRate : null;
                const monotonic = prevHr === null || e.actualHitRate >= prevHr - 0.005;
                return (
                  <tr key={e.label} className="border-b border-border/20 hover:bg-slate-800/30">
                    <td className="px-3 py-1.5 text-foreground">{e.label}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{e.n.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">{pct(e.avgPredicted)}</td>
                    <td className={cn("px-3 py-1.5 text-right font-semibold",
                      e.n === 0 ? "text-muted-foreground" :
                      e.actualHitRate > 0.70 ? "text-emerald-400" :
                      e.actualHitRate > 0.60 ? "text-green-400" :
                      e.actualHitRate > 0.50 ? "text-yellow-400" : "text-red-400"
                    )}>
                      {e.n > 0 ? pct(e.actualHitRate) : "—"}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right",
                      Math.abs(gap) < 0.02 ? "text-emerald-400" :
                      Math.abs(gap) < 0.05 ? "text-yellow-400" : "text-orange-400"
                    )}>
                      {e.n > 0 ? `${gap >= 0 ? "+" : ""}${pct(gap)}` : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {e.n === 0
                        ? <span className="text-muted-foreground">no data</span>
                        : monotonic
                        ? <span className="text-emerald-400">✓ monotonic</span>
                        : <span className="text-red-400">⚠ inversion</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground font-mono mt-2">
          Edge = |predicted pOver − 50%|. Monotonic = higher edge → higher hit rate.
          An inversion means the model is over-confident at that edge level.
        </p>
      </section>

    </div>
  );
}
