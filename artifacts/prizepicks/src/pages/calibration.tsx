import { useState, useMemo } from "react";
import { useGetCalibrationDiagnostics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ZAxis, ReferenceLine,
} from "recharts";
import { Target, TrendingUp, BarChart2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const BUCKET_LABEL: Record<string, string> = {
  "0-5":   "50–55%",
  "5-10":  "55–60%",
  "10-15": "60–65%",
  "15-20": "65–70%",
  "20-25": "70–75%",
  "25+":   "75%+",
};

function pct(v: number | undefined | null, digits = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function errColor(e: number) {
  if (e <= 0.03) return "text-emerald-400";
  if (e <= 0.07) return "text-yellow-400";
  return "text-rose-400";
}

function SummaryCard({
  label, value, sub, icon: Icon, color,
}: { label: string; value: string; sub: string; icon: React.ElementType; color: string }) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <p className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground truncate">{label}</p>
            <p className={cn("text-2xl font-bold font-mono tabular-nums", color)}>{value}</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">{sub}</p>
          </div>
          <Icon className={cn("w-5 h-5 shrink-0 mt-1", color)} />
        </div>
      </CardContent>
    </Card>
  );
}

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  const r = Math.sqrt(payload.n / 1000) * 18 + 5;
  return <circle cx={cx} cy={cy} r={Math.min(r, 28)} fill={props.fill} fillOpacity={0.85} stroke={props.fill} strokeWidth={1} />;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-slate-950 border border-slate-700 rounded p-3 text-xs font-mono space-y-1 shadow-xl">
      <div className="text-slate-300 font-semibold">
        {BUCKET_LABEL[d.bucket] ?? d.bucket} <span className="text-muted-foreground">({d.dir})</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-400 pt-1">
        <span>Predicted</span><span className="text-slate-200">{pct(d.x / 100)}</span>
        <span>Actual</span><span className="text-slate-200">{pct(d.y / 100)}</span>
        <span>Cal. Error</span><span className={errColor(Math.abs((d.x - d.y) / 100))}>{pct(Math.abs(d.x - d.y) / 100, 2)}</span>
        <span>Samples</span><span className="text-slate-200">{d.n.toLocaleString()}</span>
      </div>
    </div>
  );
};

export default function CalibrationPage() {
  const [sport, setSport]       = useState<string>("all");
  const [statType, setStatType] = useState<string>("all");

  const params = {
    ...(sport    !== "all" && { sport }),
    ...(statType !== "all" && { statType }),
  };

  const { data, isLoading } = useGetCalibrationDiagnostics(params, {
    query: { queryKey: ["calibration-diagnostics", sport, statType], staleTime: 60_000 },
  });

  const d = data as any;

  const { overData, underData } = useMemo(() => {
    if (!d?.buckets) return { overData: [], underData: [] };
    const toPoint = (b: any) => ({
      x: Math.round(b.predictedProb * 1000) / 10,
      y: Math.round(b.actualRate    * 1000) / 10,
      n: b.sampleSize,
      bucket: b.edgeBucket,
      dir: b.direction,
    });
    return {
      overData:  (d.buckets as any[]).filter(b => b.direction === "over") .map(toPoint),
      underData: (d.buckets as any[]).filter(b => b.direction === "under").map(toPoint),
    };
  }, [d]);

  const sports    = d?.filters?.sports    as string[] | undefined;
  const statTypes = d?.filters?.statTypes as string[] | undefined;

  return (
    <div className="space-y-6 h-full overflow-auto">
      {/* Header */}
      <div className="border-b border-border pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Model Calibration</h1>
          <p className="text-sm text-muted-foreground font-mono mt-0.5">
            Reliability of predicted probabilities vs empirical outcomes
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Select value={sport} onValueChange={v => { setSport(v); setStatType("all"); }}>
            <SelectTrigger className="w-36 h-8 text-xs font-mono bg-slate-900 border-slate-700">
              <SelectValue placeholder="All sports" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-xs font-mono">
              <SelectItem value="all">All sports</SelectItem>
              {sports?.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statType} onValueChange={setStatType}>
            <SelectTrigger className="w-44 h-8 text-xs font-mono bg-slate-900 border-slate-700">
              <SelectValue placeholder="All stat types" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-xs font-mono max-h-60 overflow-auto">
              <SelectItem value="all">All stat types</SelectItem>
              {statTypes?.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 bg-slate-900" />)}
          </div>
          <Skeleton className="h-80 bg-slate-900 w-full" />
          <Skeleton className="h-64 bg-slate-900 w-full" />
        </div>
      ) : d ? (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="ECE"
              value={pct(d.summary.ece, 2)}
              sub="Expected Calibration Error"
              icon={Target}
              color={d.summary.ece <= 0.03 ? "text-emerald-400" : d.summary.ece <= 0.07 ? "text-yellow-400" : "text-rose-400"}
            />
            <SummaryCard
              label="Brier Score"
              value={d.summary.brierScore.toFixed(4)}
              sub="lower = better (0 is perfect)"
              icon={TrendingUp}
              color={d.summary.brierScore <= 0.2 ? "text-emerald-400" : d.summary.brierScore <= 0.25 ? "text-yellow-400" : "text-rose-400"}
            />
            <SummaryCard
              label="Total Samples"
              value={d.summary.totalSamples.toLocaleString()}
              sub="historical outcomes"
              icon={BarChart2}
              color="text-sky-400"
            />
            <SummaryCard
              label="Max Cal. Error"
              value={pct(d.summary.maxCalibrationError, 1)}
              sub="worst single bucket"
              icon={AlertTriangle}
              color={d.summary.maxCalibrationError <= 0.05 ? "text-emerald-400" : d.summary.maxCalibrationError <= 0.12 ? "text-yellow-400" : "text-rose-400"}
            />
          </div>

          {/* Reliability Diagram */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">
                Reliability Diagram
                <span className="ml-2 text-[10px] font-normal text-muted-foreground normal-case">
                  Dot size ∝ sample size · dots on the dashed line = perfect calibration
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Predicted"
                      domain={[40, 102]}
                      tickFormatter={v => `${v}%`}
                      stroke="#64748b" fontSize={10} tickLine={false} axisLine={false}
                      label={{ value: "Predicted Probability", position: "insideBottom", offset: -12, fill: "#64748b", fontSize: 11, fontFamily: "monospace" }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Actual"
                      domain={[20, 102]}
                      tickFormatter={v => `${v}%`}
                      stroke="#64748b" fontSize={10} tickLine={false} axisLine={false}
                      label={{ value: "Actual Hit Rate", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 11, fontFamily: "monospace" }}
                    />
                    <ZAxis type="number" dataKey="n" range={[40, 600]} name="Samples" />
                    <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "#475569" }} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, fontFamily: "monospace", paddingTop: 8 }}
                      formatter={(v) => <span className="text-muted-foreground">{v}</span>}
                    />
                    {/* Perfect calibration reference */}
                    <ReferenceLine
                      segment={[{ x: 40, y: 40 }, { x: 102, y: 102 }] as any}
                      stroke="#334155"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                    />
                    <Scatter
                      name="Over"
                      data={overData}
                      fill="#0ea5e9"
                      shape={<CustomDot />}
                    />
                    <Scatter
                      name="Under"
                      data={underData}
                      fill="#a855f7"
                      shape={<CustomDot />}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Bucket Table */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">Calibration Table</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-muted-foreground text-[10px] uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Sport</th>
                      <th className="text-left px-3 py-3">Stat Type</th>
                      <th className="text-left px-3 py-3">Edge Bucket</th>
                      <th className="text-left px-3 py-3">Dir</th>
                      <th className="text-right px-3 py-3">Samples</th>
                      <th className="text-right px-3 py-3">Predicted</th>
                      <th className="text-right px-3 py-3">Empirical</th>
                      <th className="text-right px-3 py-3">Cal. Error</th>
                      <th className="text-right px-3 py-3">Brier</th>
                      <th className="text-right px-4 py-3">ECE Contrib</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.buckets as any[]).map((b: any, i: number) => (
                      <tr
                        key={i}
                        className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="px-4 py-2 text-slate-300 font-medium uppercase text-[10px] tracking-wider">
                          {b.sport}
                        </td>
                        <td className="px-3 py-2 text-slate-400 max-w-[140px] truncate" title={b.statType}>
                          {b.statType}
                        </td>
                        <td className="px-3 py-2 text-slate-300 font-medium">
                          {BUCKET_LABEL[b.edgeBucket] ?? b.edgeBucket}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider",
                            b.direction === "over"
                              ? "bg-sky-900/40 text-sky-400 border border-sky-700/40"
                              : "bg-violet-900/40 text-violet-400 border border-violet-700/40"
                          )}>
                            {b.direction.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300 tabular-nums font-semibold">
                          {b.sampleSize.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                          {pct(b.predictedProb)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className={cn(
                            Math.abs(b.predictedProb - b.actualRate) <= 0.03 ? "text-emerald-400" :
                            Math.abs(b.predictedProb - b.actualRate) <= 0.07 ? "text-yellow-300" : "text-rose-400"
                          )}>
                            {pct(b.actualRate)}
                          </span>
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", errColor(b.calibrationError))}>
                          {pct(b.calibrationError, 2)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                          {b.bucketBrier.toFixed(4)}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500 tabular-nums">
                          {b.ecContrib.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-700 bg-slate-950/60 font-semibold text-slate-300">
                      <td className="px-4 py-3" colSpan={4}>TOTALS / OVERALL</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-400">
                        {d.summary.totalSamples.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">—</td>
                      <td className="px-3 py-3 text-right tabular-nums">—</td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", errColor(d.summary.avgCalibrationError))}>
                        avg {pct(d.summary.avgCalibrationError, 2)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-sky-400">
                        {d.summary.brierScore.toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-sky-400">
                        ECE {pct(d.summary.ece, 2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Interpretation Guide */}
          <Card className="bg-slate-900/50 border-slate-800/60">
            <CardContent className="pt-5 pb-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">How to read this</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400 font-mono">
                <div>
                  <span className="text-slate-300">Calibration Error</span>
                  <br />|predicted − actual|. Green ≤3 pp, yellow 3–7 pp, red &gt;7 pp. A perfectly calibrated model has 0.
                </div>
                <div>
                  <span className="text-slate-300">ECE (Expected Calibration Error)</span>
                  <br />Weighted mean of per-bucket calibration errors (weighted by sample share). Lower is better; &lt;3% is excellent.
                </div>
                <div>
                  <span className="text-slate-300">Brier Score</span>
                  <br />Mean squared error between predicted probability and binary outcome. 0 = perfect, 0.25 = uninformative baseline. Lower is better.
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm font-mono">
          No calibration data available. Run a calibration job first.
        </div>
      )}
    </div>
  );
}
