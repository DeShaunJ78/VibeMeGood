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
  DollarSign,
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

function roiColor(v: number) {
  if (v > 0.10)  return "text-emerald-400";
  if (v > 0.02)  return "text-green-400";
  if (v > -0.02) return "text-yellow-400";
  if (v > -0.08) return "text-orange-400";
  return "text-red-400";
}

function clvColor(v: number) {
  if (v > 0.05)  return "text-emerald-400";
  if (v > 0.01)  return "text-green-400";
  if (v > -0.03) return "text-slate-300";
  if (v > -0.08) return "text-orange-400";
  return "text-red-400";
}

function varianceColor(v: number) {
  if (v < 0.40) return "text-emerald-400";
  if (v < 0.60) return "text-yellow-400";
  if (v < 0.80) return "text-orange-400";
  return "text-red-400";
}

function signed(v: number, decimals = 1) {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
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
        void qc.invalidateQueries({ queryKey: getGetAuditLatestQueryKey() });
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

      {/* ── Tier 5: ROI / CLV audit ── */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5" />
          Tier 5 — ROI / CLV Audit
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mb-3">
          Flat $1 even-money simulation per prediction.
          Realized ROI = 2×hitRate−1. Predicted ROI = 2×avg(|pOver−50%|).
          CLV = Realized − Predicted (positive = model underestimated real edge).
        </p>

        {(() => {
          const hasRoiData = perEdgeBucket.some(b => b.predictedROI !== undefined);

          if (!hasRoiData) {
            return (
              <div className="border border-amber-900/40 bg-amber-950/20 rounded p-4 text-center space-y-2">
                <div className="text-amber-400 font-mono text-xs">
                  ROI / CLV data not present in this audit run.
                </div>
                <div className="text-muted-foreground font-mono text-[10px]">
                  Re-run the audit to generate Tier 5 metrics.
                </div>
              </div>
            );
          }

          // derive insight answers
          const activeBuckets = perEdgeBucket.filter(b => b.n > 0 && b.realizedROI !== undefined);
          const peakBucket    = activeBuckets.reduce<typeof activeBuckets[0] | null>(
            (best, b) => (best === null || (b.realizedROI ?? -Infinity) > (best.realizedROI ?? -Infinity)) ? b : best,
            null,
          );
          const roiMonotonic  = activeBuckets.every((b, i) =>
            i === 0 || (b.realizedROI ?? 0) >= (activeBuckets[i - 1].realizedROI ?? 0) - 0.02
          );
          const totalN        = activeBuckets.reduce((s, b) => s + b.n, 0);
          const weightedCLV   = totalN > 0
            ? activeBuckets.reduce((s, b) => s + (b.clv ?? 0) * b.n, 0) / totalN
            : 0;
          const highVarBucket = activeBuckets.reduce<typeof activeBuckets[0] | null>(
            (worst, b) => (worst === null || (b.variance ?? 0) > (worst.variance ?? 0)) ? b : worst,
            null,
          );

          return (
            <div className="space-y-4">

              {/* summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Peak ROI Bucket</div>
                  <div className={cn("text-xl font-mono font-bold", peakBucket ? roiColor(peakBucket.realizedROI ?? 0) : "text-muted-foreground")}>
                    {peakBucket ? peakBucket.label : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {peakBucket ? signed(peakBucket.realizedROI ?? 0) + " ROI" : "no data"}
                  </div>
                </div>

                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Weighted CLV</div>
                  <div className={cn("text-xl font-mono font-bold", clvColor(weightedCLV))}>
                    {signed(weightedCLV)}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {weightedCLV > 0.01 ? "model undersells real edge" : weightedCLV < -0.03 ? "model over-confident" : "close to model prediction"}
                  </div>
                </div>

                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">ROI vs Edge</div>
                  <div className={cn("text-xl font-mono font-bold", roiMonotonic ? "text-emerald-400" : "text-orange-400")}>
                    {roiMonotonic ? "✓ mono" : "⚠ inv"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {roiMonotonic ? "ROI rises with edge" : "inversion present"}
                  </div>
                </div>

                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Max Variance (σ)</div>
                  <div className={cn("text-xl font-mono font-bold", highVarBucket ? varianceColor(highVarBucket.variance ?? 0) : "text-muted-foreground")}>
                    {highVarBucket ? (((highVarBucket.variance ?? 0) * 100).toFixed(1) + "%") : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {highVarBucket ? `in ${highVarBucket.label} bucket` : "no data"}
                  </div>
                </div>
              </div>

              {/* per-bucket table */}
              <div className="border border-border/50 rounded overflow-hidden">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="border-b border-border/50 bg-slate-900/80">
                      <th className="px-3 py-2 text-left text-muted-foreground font-normal">Edge bucket</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">n</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Hit rate</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Pred. ROI</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Realized ROI</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">CLV</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">σ</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-normal">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perEdgeBucket.map((e) => {
                      const rROI = e.realizedROI ?? 0;
                      const pROI = e.predictedROI ?? 0;
                      const clv  = e.clv ?? 0;
                      const vari = e.variance ?? 0;

                      let signal: React.ReactNode;
                      if (e.n === 0) {
                        signal = <span className="text-muted-foreground">no data</span>;
                      } else if (rROI > 0.10 && clv > 0) {
                        signal = <span className="text-emerald-400 font-semibold">STRONG EDGE</span>;
                      } else if (rROI > 0 && clv >= -0.03) {
                        signal = <span className="text-green-400">POSITIVE</span>;
                      } else if (clv < -0.08) {
                        signal = <span className="text-red-400">OVER-CONFIDENT</span>;
                      } else if (rROI < -0.05) {
                        signal = <span className="text-orange-400">NEGATIVE ROI</span>;
                      } else {
                        signal = <span className="text-slate-400">NEUTRAL</span>;
                      }

                      return (
                        <tr key={e.label} className="border-b border-border/20 hover:bg-slate-800/30">
                          <td className="px-3 py-2 text-foreground">{e.label}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{e.n.toLocaleString()}</td>
                          <td className={cn("px-3 py-2 text-right", chrColor(e.actualHitRate))}>
                            {e.n > 0 ? pct(e.actualHitRate) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400">
                            {e.n > 0 ? signed(pROI) : "—"}
                          </td>
                          <td className={cn("px-3 py-2 text-right font-semibold", e.n > 0 ? roiColor(rROI) : "text-muted-foreground")}>
                            {e.n > 0 ? signed(rROI) : "—"}
                          </td>
                          <td className={cn("px-3 py-2 text-right font-semibold", e.n > 0 ? clvColor(clv) : "text-muted-foreground")}>
                            {e.n > 0 ? signed(clv) : "—"}
                          </td>
                          <td className={cn("px-3 py-2 text-right", e.n > 0 ? varianceColor(vari) : "text-muted-foreground")}>
                            {e.n > 0 ? pct(vari) : "—"}
                          </td>
                          <td className="px-3 py-2">{signal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-muted-foreground font-mono">
                Pred. ROI = 2×avgEdge (model's expected return). Realized ROI = 2×hitRate−1 (actual return).
                σ = std dev of $±1 per-bet outcomes. High σ at high edge is normal — variance is the price of expected value.
              </p>
            </div>
          );
        })()}
      </section>

      {/* ── Tier 5A: edge decile audit ── */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" />
          Tier 5A — Edge Decile Audit
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mb-3">
          Rank-based bands — each row is an exclusive percentile slice of the edge distribution.
          Threshold = minimum |pOver−50%| to qualify. Volume = % of all predictions in this band.
        </p>

        {(() => {
          const db = data.perDecileBucket;
          if (!db || db.length === 0) {
            return (
              <div className="border border-amber-900/40 bg-amber-950/20 rounded p-4 text-center space-y-2">
                <div className="text-amber-400 font-mono text-xs">
                  Decile data not present in this audit run.
                </div>
                <div className="text-muted-foreground font-mono text-[10px]">
                  Re-run the audit to generate Tier 5A metrics.
                </div>
              </div>
            );
          }

          const active    = db.filter(b => b.n > 0);
          const top1      = active.find(b => b.label === "Top 1%");
          const restBand  = active.find(b => b.label === "Rest");
          const peakDecile = active.reduce<typeof active[0] | null>(
            (best, b) => b.label !== "Rest" && (best === null || b.realizedROI > best.realizedROI) ? b : best,
            null,
          );
          const totalN = active.reduce((s, b) => s + b.n, 0);
          const top20Band = active.find(b => b.label === "Top 20%");

          return (
            <div className="space-y-4">

              {/* summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Top 1% Threshold</div>
                  <div className="text-xl font-mono font-bold text-foreground">
                    {top1 ? pct(top1.threshold) : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {top1 ? `${top1.n.toLocaleString()} picks (${pct(top1.pctOfAll, 1)} of all)` : "no data"}
                  </div>
                </div>

                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Top 1% ROI</div>
                  <div className={cn("text-xl font-mono font-bold", top1 ? roiColor(top1.realizedROI) : "text-muted-foreground")}>
                    {top1 ? signed(top1.realizedROI) : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {top1 ? `${pct(top1.hitRate)} hit rate` : "no data"}
                  </div>
                </div>

                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Volume at Top 20%+</div>
                  <div className="text-xl font-mono font-bold text-foreground">
                    {top20Band
                      ? pct(active.filter(b => b.label !== "Rest").reduce((s, b) => s + b.pctOfAll, 0), 0)
                      : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {top20Band
                      ? `${active.filter(b => b.label !== "Rest").reduce((s, b) => s + b.n, 0).toLocaleString()} of ${totalN.toLocaleString()} picks`
                      : "no data"}
                  </div>
                </div>

                <div className="border border-border/50 bg-slate-900/60 rounded px-4 py-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Rest ROI</div>
                  <div className={cn("text-xl font-mono font-bold", restBand ? roiColor(restBand.realizedROI) : "text-muted-foreground")}>
                    {restBand ? signed(restBand.realizedROI) : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    bottom 80% · {restBand ? pct(restBand.pctOfAll, 0) + " of all picks" : "no data"}
                  </div>
                </div>
              </div>

              {/* decile table */}
              <div className="border border-border/50 rounded overflow-hidden">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="border-b border-border/50 bg-slate-900/80">
                      <th className="px-3 py-2 text-left text-muted-foreground font-normal">Band</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Threshold</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">n</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">% of all</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Avg edge</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Hit rate</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Pred. ROI</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">Realized ROI</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-normal">CLV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.map((b) => {
                      const isRest = b.label === "Rest";
                      const isPeak = peakDecile?.label === b.label;
                      return (
                        <tr
                          key={b.label}
                          className={cn(
                            "border-b border-border/20 hover:bg-slate-800/30",
                            isPeak && "bg-emerald-950/20",
                            isRest && "opacity-50",
                          )}
                        >
                          <td className="px-3 py-2 font-semibold text-foreground">
                            {b.label}
                            {isPeak && <span className="ml-2 text-[9px] text-emerald-400 font-mono">PEAK</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400">
                            {b.n > 0 ? `≥ ${pct(b.threshold)}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {b.n.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-300">
                            {b.n > 0 ? pct(b.pctOfAll, 1) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400">
                            {b.n > 0 ? pct(b.avgEdge) : "—"}
                          </td>
                          <td className={cn("px-3 py-2 text-right", chrColor(b.hitRate))}>
                            {b.n > 0 ? pct(b.hitRate) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400">
                            {b.n > 0 ? signed(b.predictedROI) : "—"}
                          </td>
                          <td className={cn("px-3 py-2 text-right font-semibold", b.n > 0 ? roiColor(b.realizedROI) : "text-muted-foreground")}>
                            {b.n > 0 ? signed(b.realizedROI) : "—"}
                          </td>
                          <td className={cn("px-3 py-2 text-right", b.n > 0 ? clvColor(b.clv) : "text-muted-foreground")}>
                            {b.n > 0 ? signed(b.clv) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-muted-foreground font-mono">
                Bands are mutually exclusive. "Top 1%" = predictions above the 99th percentile edge; "Rest" = bottom 80%.
                Threshold is computed fresh each audit run from the actual edge distribution.
                Highlighted row = peak realized ROI band.
              </p>
            </div>
          );
        })()}
      </section>

    </div>
  );
}
