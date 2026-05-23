import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from "recharts";
import { format, parseISO } from "date-fns";

interface ClvRecord {
  id: number;
  clv: string | null;
  lockedLine: string;
  closingLine: string | null;
  direction: string | null;
  createdAt: string;
  pickResult: string;
  statType: string;
  lineType: string;
  playerName: string;
  team: string;
  sport: string;
}

interface ClvResponse {
  records: ClvRecord[];
  summary: {
    avg7d: number | null;
    avg30d: number | null;
    avg90d: number | null;
    total: number;
    positiveCount: number;
    positiveRate: number | null;
    overallAvg: number | null;
  };
  clvByDay: { date: string; avgClv: number; count: number }[];
  clvBySport: { sport: string; avgClv: number; count: number }[];
}

function useClv() {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  return useQuery<ClvResponse>({
    queryKey: ["clv"],
    queryFn: () => fetch(`${base}/api/clv`).then(r => r.json()),
    staleTime: 60_000,
  });
}

function ClvValue({ val, size = "sm" }: { val: number | string | null | undefined; size?: "sm" | "lg" }) {
  if (val === null || val === undefined) return <span className="text-muted-foreground">—</span>;
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return <span className="text-muted-foreground">—</span>;
  const color = n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-slate-400";
  const sizeClass = size === "lg" ? "text-2xl font-bold" : "text-sm font-mono";
  return (
    <span className={`${color} ${sizeClass} font-mono`}>
      {n > 0 ? "+" : ""}{n.toFixed(2)}
    </span>
  );
}

function BehavioralMessage({ summary }: { summary: ClvResponse["summary"] }) {
  const { avg30d, positiveRate } = summary;
  if (avg30d === null || summary.total < 5) return null;

  if (avg30d > 0 && positiveRate !== null && positiveRate < 50) {
    return (
      <div className="flex gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg p-3 text-xs font-mono text-amber-300">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Recent wins may be luck. The market moved against your picks after you locked them. Reassess your pick selection process before increasing stakes.</span>
      </div>
    );
  }
  if (avg30d < 0 && positiveRate !== null && positiveRate >= 50) {
    return (
      <div className="flex gap-2 bg-sky-950/30 border border-sky-800/40 rounded-lg p-3 text-xs font-mono text-sky-300">
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Your process is sound. This is variance, not a broken system. Do not change strategy.</span>
      </div>
    );
  }
  return null;
}

export default function Clv() {
  const { data, isLoading } = useClv();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold font-mono text-foreground">CLV Tracker</h1>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">
          Closing Line Value — did lines move in your favour after you locked in?
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 bg-slate-800 rounded" />)}
        </div>
      ) : !data || data.records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-slate-800 rounded-lg bg-slate-900/50">
          <BarChart3 className="w-10 h-10 text-slate-600 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">No CLV records yet</p>
          <p className="font-mono text-xs text-slate-600 mt-1 max-w-xs">
            CLV is recorded automatically when you grade picks as HIT or MISS in the Journal.
          </p>
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "7-day Avg CLV",  val: data.summary.avg7d  },
              { label: "30-day Avg CLV", val: data.summary.avg30d },
              { label: "90-day Avg CLV", val: data.summary.avg90d },
              { label: "Overall Avg",    val: data.summary.overallAvg },
            ].map(({ label, val }) => (
              <div key={label} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
                <ClvValue val={val} size="lg" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Total Graded</div>
              <div className="text-2xl font-bold font-mono text-foreground">{data.summary.total}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Positive CLV</div>
              <div className="text-2xl font-bold font-mono text-emerald-400">{data.summary.positiveCount}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Positive Rate</div>
              <div className="text-2xl font-bold font-mono text-foreground">
                {data.summary.positiveRate !== null ? `${data.summary.positiveRate}%` : "—"}
              </div>
            </div>
          </div>

          <BehavioralMessage summary={data.summary} />

          {/* 30-day trend chart */}
          {data.clvByDay.length >= 2 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">30-Day CLV Trend</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={data.clvByDay} margin={{ left: -10, right: 10, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "#4a6a8a" }}
                    tickFormatter={d => format(parseISO(d), "M/d")}
                  />
                  <YAxis tick={{ fontSize: 9, fontFamily: "monospace", fill: "#4a6a8a" }} />
                  <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 2" />
                  <Tooltip
                    contentStyle={{ background: "#0d1625", border: "1px solid #1a2a3f", fontSize: 11, fontFamily: "monospace" }}
                    formatter={(v: number) => [v > 0 ? `+${v}` : `${v}`, "Avg CLV"]}
                    labelFormatter={d => format(parseISO(d as string), "MMM d")}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgClv"
                    stroke="#00d4ff"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* By sport */}
          {data.clvBySport.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Breakdown by Sport</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {data.clvBySport.map(s => (
                  <div key={s.sport} className="bg-slate-800/50 rounded p-2">
                    <div className="text-[10px] font-mono text-muted-foreground mb-0.5">{s.sport}</div>
                    <ClvValue val={s.avgClv} />
                    <div className="text-[10px] text-slate-600 font-mono">{s.count} picks</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Records table */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider p-3 border-b border-slate-800">
              Pick-by-Pick History
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-muted-foreground">
                    <th className="text-left px-3 py-2">Player</th>
                    <th className="text-left px-3 py-2">Stat</th>
                    <th className="text-right px-3 py-2">Locked</th>
                    <th className="text-right px-3 py-2">Closing</th>
                    <th className="text-right px-3 py-2">CLV</th>
                    <th className="text-center px-3 py-2">Result</th>
                    <th className="text-right px-3 py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map(r => {
                    const clvNum = r.clv ? parseFloat(r.clv) : null;
                    return (
                      <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-3 py-2 text-foreground">{r.playerName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.statType}</td>
                        <td className="px-3 py-2 text-right">{parseFloat(r.lockedLine).toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">
                          {r.closingLine ? parseFloat(r.closingLine).toFixed(1) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ClvValue val={clvNum} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`uppercase text-[10px] font-bold ${
                            r.pickResult === "hit" ? "text-emerald-400"
                            : r.pickResult === "miss" ? "text-red-400"
                            : "text-muted-foreground"
                          }`}>
                            {r.pickResult}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {r.createdAt ? format(parseISO(r.createdAt), "M/d") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
