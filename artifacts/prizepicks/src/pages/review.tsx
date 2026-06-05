import { useGetReviewStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  ComposedChart,
} from "recharts";
import { TrendingUp, TrendingDown, Percent, DollarSign, Target, Brain, ChevronDown, ChevronUp, Download, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { CsvColumnPickerDialog, type CsvColGroup } from "@/lib/csv-export";
import { Tooltip as UiTooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

const SPORTS = ["NFL", "NBA", "MLB", "NHL", "WNBA", "MMA", "PGA", "NASCAR", "SOCCER"];

const CLV_COVERAGE_WARNING_THRESHOLD = 0.30;

interface StatBiasBucket {
  sport: string | null;
  statType: string;
  tier: string;
  totalCount: number;
  gradedCount: number;
  pendingCount: number;
  hitCount: number;
  hitRate: number | null;
  avgModelPOver: number | null;
  delta: number | null;
  hasEnoughData: boolean;
}

interface PlayerBiasBucket {
  playerId: number | null;
  playerName: string | null;
  imageUrl: string | null;
  sport: string | null;
  statType: string;
  tier: string;
  totalCount: number;
  gradedCount: number;
  pendingCount: number;
  hitCount: number;
  hitRate: number | null;
  avgModelPOver: number | null;
  delta: number | null;
  hasEnoughData: boolean;
}

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

const EMOTION_EMOJI: Record<string, string> = {
  confident: "💪", neutral: "😐", frustrated: "😤",
  excited: "🔥", anxious: "😰", unknown: "🎯",
};

export default function Review() {
  const { data: stats, isLoading } = useGetReviewStats(undefined, {
    query: { queryKey: ["review-stats"] }
  });
  const [csvPickerOpen, setCsvPickerOpen] = useState(false);
  const [csvDateFrom, setCsvDateFrom] = useState("");
  const [csvDateTo, setCsvDateTo] = useState("");
  const [csvSport, setCsvSport] = useState("");
  const [csvEntryType, setCsvEntryType] = useState("");
  const [biasOpen, setBiasOpen] = useState(true);
  const [biasGroupBy, setBiasGroupBy] = useState<"statType" | "player">("statType");
  const [biasSortKey, setBiasSortKey] = useState<"hitRate" | "delta" | "gradedCount">("hitRate");
  const [biasSortDir, setBiasSortDir] = useState<"desc" | "asc">("desc");
  const [playerSortKey, setPlayerSortKey] = useState<"hitRate" | "delta" | "gradedCount">("hitRate");
  const [playerSortDir, setPlayerSortDir] = useState<"desc" | "asc">("desc");
  const [slateOnly, setSlateOnly] = useState(false);

  const { data: biasData } = useQuery<{ buckets: StatBiasBucket[] }>({
    queryKey: ["stat-bias"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/dashboard/stat-bias`);
      if (!r.ok) throw new Error("Failed to load stat bias");
      return r.json();
    },
    staleTime: 60_000,
  });

  const { data: playerBiasData } = useQuery<{ buckets: PlayerBiasBucket[] }>({
    queryKey: ["stat-bias-player"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/dashboard/stat-bias?groupBy=player`);
      if (!r.ok) throw new Error("Failed to load player bias");
      return r.json();
    },
    staleTime: 60_000,
    enabled: biasGroupBy === "player",
  });

  const { data: slatePlayerIds } = useQuery<Set<number>>({
    queryKey: ["slate-active-player-ids"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/slate`);
      if (!r.ok) throw new Error("Failed to load slate");
      const d = await r.json() as { rows?: Array<{ playerId: number | null }> };
      return new Set((d.rows ?? []).map((row) => row.playerId).filter((id): id is number => id != null));
    },
    staleTime: 120_000,
    enabled: biasGroupBy === "player" && slateOnly,
  });

  const allBuckets = (biasData?.buckets ?? []) as StatBiasBucket[];
  const qualifiedBuckets = allBuckets.filter(b => b.hasEnoughData);

  const allPlayerBuckets = (playerBiasData?.buckets ?? []) as PlayerBiasBucket[];
  const qualifiedPlayerBuckets = allPlayerBuckets.filter(b => b.hasEnoughData);
  const insufficientPlayerBuckets = allPlayerBuckets.filter(b => !b.hasEnoughData);

  function toggleBiasSort(key: "hitRate" | "delta" | "gradedCount") {
    if (biasSortKey === key) {
      setBiasSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setBiasSortKey(key);
      setBiasSortDir("desc");
    }
  }

  function togglePlayerSort(key: "hitRate" | "delta" | "gradedCount") {
    if (playerSortKey === key) {
      setPlayerSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setPlayerSortKey(key);
      setPlayerSortDir("desc");
    }
  }

  // Qualified buckets sorted by chosen key; insufficient-data buckets appended at end
  const sortedQualified = [...qualifiedBuckets].sort((a, b) => {
    const av = a[biasSortKey] ?? -Infinity;
    const bv = b[biasSortKey] ?? -Infinity;
    return biasSortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });
  const insufficientBuckets = allBuckets.filter(b => !b.hasEnoughData);
  const sortedBuckets = [...sortedQualified, ...insufficientBuckets];

  const sortedQualifiedPlayers = [...qualifiedPlayerBuckets].sort((a, b) => {
    const av = a[playerSortKey] ?? -Infinity;
    const bv = b[playerSortKey] ?? -Infinity;
    return playerSortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });
  const sortedPlayerBuckets = [...sortedQualifiedPlayers, ...insufficientPlayerBuckets];

  const filteredPlayerBuckets = slateOnly && slatePlayerIds
    ? sortedPlayerBuckets.filter(b => b.playerId != null && slatePlayerIds.has(b.playerId))
    : sortedPlayerBuckets;

  function handleExportCsv(cols: Set<CsvColGroup>) {
    const qs = new URLSearchParams();
    if (csvDateFrom)  qs.set("dateFrom", csvDateFrom);
    if (csvDateTo)    qs.set("dateTo", csvDateTo);
    if (csvSport)     qs.set("sport", csvSport);
    if (csvEntryType) qs.set("entryType", csvEntryType);
    if (cols.size < 4) qs.set("cols", [...cols].join(","));
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const url = `${base}/api/entries/export.csv?${qs.toString()}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `review-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const s = stats as any;

  return (
    <div className="space-y-6 h-full overflow-auto">
      <div className="border-b border-border pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Review Dashboard</h1>
          <Button
            variant="outline"
            onClick={() => setCsvPickerOpen(true)}
            title="Export pick-level data to CSV"
            className="font-mono text-xs h-8 px-3 border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
        {/* ── Compact export filter bar ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-slate-500 uppercase">Export filters:</span>
          <div className="flex items-center gap-1">
            <label className="text-[10px] font-mono text-slate-500 uppercase">From</label>
            <Input
              type="date"
              value={csvDateFrom}
              onChange={e => setCsvDateFrom(e.target.value)}
              className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-32 px-2"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] font-mono text-slate-500 uppercase">To</label>
            <Input
              type="date"
              value={csvDateTo}
              onChange={e => setCsvDateTo(e.target.value)}
              className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-32 px-2"
            />
          </div>
          <Select value={csvSport || "_all"} onValueChange={v => setCsvSport(v === "_all" ? "" : v)}>
            <SelectTrigger className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-24">
              <SelectValue placeholder="Sport" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all" className="font-mono text-xs">All sports</SelectItem>
              {SPORTS.map(s => (
                <SelectItem key={s} value={s} className="font-mono text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={csvEntryType || "_all"} onValueChange={v => setCsvEntryType(v === "_all" ? "" : v)}>
            <SelectTrigger className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-24">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all" className="font-mono text-xs">All types</SelectItem>
              <SelectItem value="power" className="font-mono text-xs">Power</SelectItem>
              <SelectItem value="flex" className="font-mono text-xs">Flex</SelectItem>
            </SelectContent>
          </Select>
          {(csvDateFrom || csvDateTo || csvSport || csvEntryType) && (
            <button
              onClick={() => { setCsvDateFrom(""); setCsvDateTo(""); setCsvSport(""); setCsvEntryType(""); }}
              className="text-[10px] font-mono text-slate-500 hover:text-slate-300 underline underline-offset-2"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <CsvColumnPickerDialog
        open={csvPickerOpen}
        onClose={() => setCsvPickerOpen(false)}
        onExport={handleExportCsv}
      />

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 bg-slate-900" />)}
          </div>
          <Skeleton className="h-72 bg-slate-900 w-full" />
          <Skeleton className="h-64 bg-slate-900 w-full" />
        </div>
      ) : s ? (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              label="Total P&L"
              value={`${s.totalPnl >= 0 ? "+" : ""}$${Number(s.totalPnl).toFixed(2)}`}
              sub={`${s.totalEntries} settled entries`}
              icon={DollarSign}
              color={s.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
            <StatCard
              label="Entry Hit Rate"
              value={s.overallHitRate != null ? `${(s.overallHitRate * 100).toFixed(1)}%` : "—"}
              sub="wins / settled"
              icon={Percent}
              color="text-primary"
            />
            <StatCard
              label="Pick Hit Rate"
              value={s.pickHitRate != null ? `${(Number(s.pickHitRate) * 100).toFixed(1)}%` : "—"}
              sub="individual legs"
              icon={TrendingUp}
              color="text-emerald-400"
            />
            {(() => {
              const clvLowCoverage = s.clvCoverage != null && Number(s.clvCoverage) < CLV_COVERAGE_WARNING_THRESHOLD;
              const card = (
                <StatCard
                  label="Avg CLV"
                  value={s.avgClv != null ? `${Number(s.avgClv) > 0 ? "+" : ""}${Number(s.avgClv).toFixed(2)}` : "—"}
                  sub={s.clvCoverage != null ? `${Math.round(Number(s.clvCoverage) * 100)}% CLV coverage` : "closing line value"}
                  icon={clvLowCoverage ? AlertTriangle : (s.avgClv != null && Number(s.avgClv) >= 0 ? TrendingUp : TrendingDown)}
                  color={clvLowCoverage ? "text-amber-400" : (s.avgClv != null && Number(s.avgClv) >= 0 ? "text-emerald-400" : "text-rose-400")}
                />
              );
              if (!clvLowCoverage) return card;
              return (
                <TooltipProvider delayDuration={200}>
                  <UiTooltip>
                    <TooltipTrigger asChild><div>{card}</div></TooltipTrigger>
                    <TooltipContent className="max-w-[220px] text-center font-mono text-[11px] bg-slate-900 border-slate-700 text-amber-300">
                      Only {Math.round(Number(s.clvCoverage) * 100)}% of legs have closing line data — below the {Math.round(CLV_COVERAGE_WARNING_THRESHOLD * 100)}% threshold. This average may not be reliable.
                    </TooltipContent>
                  </UiTooltip>
                </TooltipProvider>
              );
            })()}
            <StatCard
              label="Kelly Adherence"
              value={(s as any).kellyAdherenceRate != null ? `${((s as any).kellyAdherenceRate * 100).toFixed(0)}%` : "—"}
              sub="stake ≤ half-Kelly"
              icon={Target}
              color={(s as any).kellyAdherenceRate != null && (s as any).kellyAdherenceRate >= 0.7 ? "text-emerald-400" : "text-amber-400"}
            />
          </div>

          {/* Bankroll Curve */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">Bankroll Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                {s.bankrollCurve && s.bankrollCurve.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={s.bankrollCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <ReferenceLine y={1000} stroke="#334155" strokeDasharray="4 4" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", color: "#f8fafc", fontFamily: "monospace", fontSize: 11 }}
                        formatter={(v: any) => [`$${v}`, "Balance"]}
                      />
                      <Line type="monotone" dataKey="balance" stroke="#0ea5e9" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm font-mono">Not enough data</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Monthly P&L */}
          {s.monthlyPnl && s.monthlyPnl.length > 0 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">Monthly P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.monthlyPnl} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", color: "#f8fafc", fontFamily: "monospace", fontSize: 11 }}
                        formatter={(v: any, _: any, props: any) => {
                          const d = props.payload;
                          return [`$${Number(v).toFixed(2)}  (${d?.wins}W / ${d?.entries} entries)`, "P&L"];
                        }}
                      />
                      <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                        {(s.monthlyPnl as any[]).map((_: any, i: number) => (
                          <Cell key={i} fill={_.pnl >= 0 ? "#10b981" : "#f43f5e"} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Kelly Adherence Over Time */}
          {Array.isArray(s.kellyAdherenceByMonth) && s.kellyAdherenceByMonth.length >= 2 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                  <Target className="w-3.5 h-3.5 text-primary" />
                  Kelly Adherence Over Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.kellyAdherenceByMonth} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 1]}
                        tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                      />
                      <ReferenceLine y={0.7} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "70%", position: "right", fill: "#f59e0b", fontSize: 10, fontFamily: "monospace" }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", color: "#f8fafc", fontFamily: "monospace", fontSize: 11 }}
                        formatter={(v: any, _: any, props: any) => {
                          const d = props.payload;
                          return [`${Math.round(Number(v) * 100)}%  (${d?.adherent}/${d?.count} entries)`, "Adherence"];
                        }}
                      />
                      <Bar dataKey="rate" radius={[3, 3, 0, 0]}>
                        {(s.kellyAdherenceByMonth as Array<{ rate: number | null }>).map((_: any, i: number) => (
                          <Cell key={i} fill={(_.rate ?? 0) >= 0.7 ? "#10b981" : (_.rate ?? 0) >= 0.5 ? "#f59e0b" : "#f43f5e"} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />≥ 70% on-target</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />50–69% borderline</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500 inline-block" />&lt; 50% over-sizing</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* CLV Coverage Trend */}
          {Array.isArray(s.clvCoverageByMonth) && (s.clvCoverageByMonth as any[]).length >= 2 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                  <Percent className="w-3.5 h-3.5 text-primary" />
                  CLV Coverage Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={s.clvCoverageByMonth as any[]} margin={{ top: 5, right: 40, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis
                        yAxisId="cov"
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 1]}
                        tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                      />
                      <YAxis
                        yAxisId="clv"
                        orientation="right"
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))}
                      />
                      <ReferenceLine yAxisId="cov" y={0.8} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "80%", position: "insideTopRight", fill: "#f59e0b", fontSize: 10, fontFamily: "monospace" }} />
                      <ReferenceLine yAxisId="clv" y={0} stroke="#475569" strokeDasharray="2 2" strokeOpacity={0.5} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", color: "#f8fafc", fontFamily: "monospace", fontSize: 11 }}
                        formatter={(v: any, name: string, props: any) => {
                          const d = props.payload;
                          if (name === "coverage") return [`${Math.round(Number(v) * 100)}%  (${d?.covered}/${d?.total} picks)`, "Coverage"];
                          if (name === "avgClv") return v != null ? [`${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}`, "Avg CLV"] : ["—", "Avg CLV"];
                          return [v, name];
                        }}
                      />
                      <Bar yAxisId="cov" dataKey="coverage" radius={[3, 3, 0, 0]}>
                        {(s.clvCoverageByMonth as Array<{ coverage: number | null }>).map((_: any, i: number) => (
                          <Cell key={i} fill={(_.coverage ?? 0) >= 0.8 ? "#10b981" : (_.coverage ?? 0) >= 0.5 ? "#f59e0b" : "#f43f5e"} fillOpacity={0.8} />
                        ))}
                      </Bar>
                      <Line yAxisId="clv" type="monotone" dataKey="avgClv" stroke="#818cf8" strokeWidth={2} dot={{ r: 3, fill: "#818cf8" }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />≥ 80% tracked</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />50–79% partial</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500 inline-block" />&lt; 50% sparse</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />avg CLV (right axis)</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Model Accuracy + Hit Rate Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Model Accuracy */}
            {s.modelAccuracy && (
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                    <Brain className="w-3.5 h-3.5 text-primary" />
                    Model Accuracy
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-center pt-2">
                    <div className={`text-4xl font-bold font-mono ${s.modelAccuracy.rate >= 0.55 ? "text-emerald-400" : s.modelAccuracy.rate >= 0.50 ? "text-amber-400" : "text-rose-400"}`}>
                      {s.modelAccuracy.rate != null ? `${(s.modelAccuracy.rate * 100).toFixed(1)}%` : "—"}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">projection direction correct</div>
                  </div>
                  <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${s.modelAccuracy.rate >= 0.55 ? "bg-emerald-500" : s.modelAccuracy.rate >= 0.50 ? "bg-amber-500" : "bg-rose-500"}`}
                      style={{ width: `${((s.modelAccuracy.rate ?? 0) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground text-center">
                    {s.modelAccuracy.correct} / {s.modelAccuracy.total} settled picks
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground bg-slate-800/50 rounded p-2">
                    <Target className="w-3 h-3 shrink-0" />
                    <span>projectionGap direction vs actual outcome</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* By Pick Count */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">By Pick Count</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5 pt-1">
                  {Object.entries((s.hitRateByPickCount as Record<string, any>) ?? {})
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([count, data]) => (
                      <div key={count} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground w-12">{count}-pick</span>
                        <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${((data.rate ?? 0) * 100).toFixed(0)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-primary w-10 text-right">
                          {data.rate != null ? `${(data.rate * 100).toFixed(0)}%` : "—"}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono w-14 text-right">
                          {data.wins}/{data.total}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* By Entry Type */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">By Entry Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 pt-1">
                  {Object.entries((s.hitRateByEntryType as Record<string, any>) ?? {}).map(([type, data]) => (
                    <div key={type} className="bg-slate-800/50 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-mono font-bold uppercase">{type}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{data.wins}W / {data.total} entries</div>
                      </div>
                      <div className={`text-2xl font-bold font-mono ${(data.rate ?? 0) >= 0.5 ? "text-emerald-400" : "text-rose-400"}`}>
                        {data.rate != null ? `${(data.rate * 100).toFixed(0)}%` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* By Stat Type */}
          {Array.isArray(s.statBreakdown) && s.statBreakdown.length > 0 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">Hit Rate by Stat Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-muted-foreground text-[10px] uppercase tracking-wider">
                        <th className="text-left py-2 pr-4">Stat Type</th>
                        <th className="text-right py-2 px-3">Picks</th>
                        <th className="text-right py-2 px-3">Hits</th>
                        <th className="text-right py-2 px-3">Hit Rate</th>
                        <th className="text-right py-2 pl-3">Avg Edge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(s.statBreakdown as Array<{ statType: string; pickCount: number; hitCount: number; hitRate: number | null; avgEdge: number | null }>).map((row) => (
                        <tr key={row.statType} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                          <td className="py-2 pr-4 text-slate-200 font-semibold">{row.statType}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{row.pickCount}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{row.hitCount}</td>
                          <td className="py-2 px-3 text-right">
                            <span className={`font-bold ${
                              row.hitRate == null ? "text-muted-foreground"
                              : row.hitRate >= 0.6 ? "text-emerald-400"
                              : row.hitRate >= 0.5 ? "text-amber-400"
                              : "text-rose-400"
                            }`}>
                              {row.hitRate != null ? `${(row.hitRate * 100).toFixed(1)}%` : "—"}
                            </span>
                          </td>
                          <td className="py-2 pl-3 text-right text-muted-foreground">
                            {row.avgEdge != null ? `${row.avgEdge.toFixed(1)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stat Type Edge Tracker */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle
                  className="text-sm font-mono uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => setBiasOpen(v => !v)}
                >
                  Stat Type Edge
                </CardTitle>
                <div className="flex items-center gap-2">
                  {/* By Stat Type / By Player toggle */}
                  <div className="flex rounded border border-slate-700 overflow-hidden text-[10px] font-mono">
                    <button
                      className={`px-2 py-0.5 transition-colors ${biasGroupBy === "statType" ? "bg-slate-700 text-slate-100" : "text-muted-foreground hover:text-slate-300"}`}
                      onClick={e => { e.stopPropagation(); setBiasGroupBy("statType"); }}
                    >
                      By Stat Type
                    </button>
                    <button
                      className={`px-2 py-0.5 border-l border-slate-700 transition-colors ${biasGroupBy === "player" ? "bg-slate-700 text-slate-100" : "text-muted-foreground hover:text-slate-300"}`}
                      onClick={e => { e.stopPropagation(); setBiasGroupBy("player"); }}
                    >
                      By Player
                    </button>
                  </div>
                  {biasGroupBy === "statType" && qualifiedBuckets.length > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">{qualifiedBuckets.length} buckets ≥ 10</span>
                  )}
                  {biasGroupBy === "player" && qualifiedPlayerBuckets.length > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {slateOnly && slatePlayerIds
                        ? `${filteredPlayerBuckets.filter(b => b.hasEnoughData).length} of ${qualifiedPlayerBuckets.length} on today's slate`
                        : `${qualifiedPlayerBuckets.length} buckets ≥ 5`}
                    </span>
                  )}
                  {biasGroupBy === "player" && (
                    <button
                      onClick={e => { e.stopPropagation(); setSlateOnly(v => !v); }}
                      className={`px-2 py-0.5 rounded border text-[10px] font-mono transition-colors ${slateOnly ? "bg-emerald-900/40 border-emerald-700/50 text-emerald-400" : "border-slate-700 text-muted-foreground hover:text-slate-300"}`}
                      title="Show only players with active lines on today's slate"
                    >
                      Today's slate
                    </button>
                  )}
                  <div className="cursor-pointer select-none" onClick={() => setBiasOpen(v => !v)}>
                    {biasOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {biasGroupBy === "statType"
                  ? "Your personal hit rate vs. model projection by stat type and tier. Bias correction can be enabled in Settings."
                  : "Your personal hit rate vs. model projection broken down per player. Minimum 5 graded picks per bucket."}
              </p>
            </CardHeader>
            {biasOpen && (
              <CardContent>
                {biasGroupBy === "statType" ? (
                  /* ── By Stat Type ── */
                  allBuckets.length === 0 ? (
                    <div className="text-center py-6 text-xs font-mono text-muted-foreground">
                      No picks logged yet. Log entries to see buckets grow here.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="border-b border-slate-800 text-muted-foreground text-[10px] uppercase tracking-wider">
                            <th className="text-left py-2 pr-4">Stat Type · Tier</th>
                            <th className="text-left py-2 pr-3">Sport</th>
                            <th className="text-right py-2 px-2 cursor-pointer hover:text-foreground" onClick={() => toggleBiasSort("gradedCount")}>
                              Graded{biasSortKey === "gradedCount" ? (biasSortDir === "desc" ? " ↓" : " ↑") : ""}
                            </th>
                            <th className="text-right py-2 px-2 text-amber-600/70">Pending</th>
                            <th className="text-right py-2 px-2 cursor-pointer hover:text-foreground" onClick={() => toggleBiasSort("hitRate")}>
                              Hit Rate{biasSortKey === "hitRate" ? (biasSortDir === "desc" ? " ↓" : " ↑") : ""}
                            </th>
                            <th className="text-right py-2 px-2 text-slate-500">Model P̄(O)</th>
                            <th className="text-right py-2 pl-2 cursor-pointer hover:text-foreground" onClick={() => toggleBiasSort("delta")}>
                              Delta{biasSortKey === "delta" ? (biasSortDir === "desc" ? " ↓" : " ↑") : ""}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedBuckets.map((b, i) => {
                            const insufficient = !b.hasEnoughData;
                            const pct = Math.min(100, Math.round((b.gradedCount / 10) * 100));
                            const deltaVal = b.delta ?? 0;
                            const deltaColor = insufficient ? "text-muted-foreground"
                              : deltaVal > 10 ? "text-emerald-400" : deltaVal < -10 ? "text-rose-400" : "text-amber-400";
                            const hitColor = insufficient || b.hitRate == null ? "text-muted-foreground"
                              : b.hitRate >= 0.6 ? "text-emerald-400"
                              : b.hitRate >= 0.5 ? "text-amber-400"
                              : "text-rose-400";
                            return (
                              <tr key={i} className={`border-b border-slate-800/50 transition-colors ${insufficient ? "opacity-60" : "hover:bg-slate-800/30"}`}>
                                <td className={`py-2 pr-4 ${insufficient ? "text-muted-foreground" : "text-slate-200 font-semibold"}`}>
                                  {b.statType}
                                  <span className="ml-1 text-[10px] text-muted-foreground capitalize font-normal">{b.tier}</span>
                                </td>
                                <td className="py-2 pr-3 text-muted-foreground">{b.sport ?? "—"}</td>
                                <td className="py-2 px-2 text-right">
                                  {insufficient ? (
                                    <span className="text-amber-600 font-bold">{b.gradedCount}
                                      <span className="text-muted-foreground font-normal">/10</span>
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">{b.gradedCount}</span>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-right text-amber-600/70">
                                  {b.pendingCount > 0 ? `+${b.pendingCount}` : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className={`py-2 px-2 text-right font-bold ${hitColor}`}>
                                  {b.hitRate != null
                                    ? `${(b.hitRate * 100).toFixed(1)}%`
                                    : insufficient
                                      ? <span className="text-[10px] text-muted-foreground italic">{pct}% there</span>
                                      : "—"}
                                </td>
                                <td className="py-2 px-2 text-right text-muted-foreground">
                                  {b.avgModelPOver != null ? `${b.avgModelPOver.toFixed(1)}%` : "—"}
                                </td>
                                <td className={`py-2 pl-2 text-right font-bold ${deltaColor}`}>
                                  {b.delta != null ? `${b.delta > 0 ? "+" : ""}${b.delta.toFixed(1)}pp` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {insufficientBuckets.length > 0 && (
                        <p className="mt-2 text-[10px] font-mono text-slate-600">
                          {insufficientBuckets.length} bucket{insufficientBuckets.length !== 1 ? "s" : ""} building toward 10 graded picks (dimmed). Delta highlights at ±10 pp.
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  /* ── By Player ── */
                  allPlayerBuckets.length === 0 ? (
                    <div className="text-center py-6 text-xs font-mono text-muted-foreground">
                      No player picks logged yet. Log entries to see player buckets grow here.
                    </div>
                  ) : filteredPlayerBuckets.length === 0 ? (
                    <div className="text-center py-6 text-xs font-mono text-muted-foreground">
                      No bias data for players on today's slate yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="border-b border-slate-800 text-muted-foreground text-[10px] uppercase tracking-wider">
                            <th className="text-left py-2 pr-4">Player</th>
                            <th className="text-left py-2 pr-3">Stat · Tier</th>
                            <th className="text-right py-2 px-2 cursor-pointer hover:text-foreground" onClick={() => togglePlayerSort("gradedCount")}>
                              Graded{playerSortKey === "gradedCount" ? (playerSortDir === "desc" ? " ↓" : " ↑") : ""}
                            </th>
                            <th className="text-right py-2 px-2 text-amber-600/70">Pending</th>
                            <th className="text-right py-2 px-2 cursor-pointer hover:text-foreground" onClick={() => togglePlayerSort("hitRate")}>
                              Hit Rate{playerSortKey === "hitRate" ? (playerSortDir === "desc" ? " ↓" : " ↑") : ""}
                            </th>
                            <th className="text-right py-2 px-2 text-slate-500">Model P̄(O)</th>
                            <th className="text-right py-2 pl-2 cursor-pointer hover:text-foreground" onClick={() => togglePlayerSort("delta")}>
                              Delta{playerSortKey === "delta" ? (playerSortDir === "desc" ? " ↓" : " ↑") : ""}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPlayerBuckets.map((b, i) => {
                            const insufficient = !b.hasEnoughData;
                            const pct = Math.min(100, Math.round((b.gradedCount / 5) * 100));
                            const deltaVal = b.delta ?? 0;
                            const deltaColor = insufficient ? "text-muted-foreground"
                              : deltaVal > 10 ? "text-emerald-400" : deltaVal < -10 ? "text-rose-400" : "text-amber-400";
                            const hitColor = insufficient || b.hitRate == null ? "text-muted-foreground"
                              : b.hitRate >= 0.6 ? "text-emerald-400"
                              : b.hitRate >= 0.5 ? "text-amber-400"
                              : "text-rose-400";
                            return (
                              <tr key={i} className={`border-b border-slate-800/50 transition-colors ${insufficient ? "opacity-60" : "hover:bg-slate-800/30"}`}>
                                <td className="py-1.5 pr-4">
                                  <div className="flex items-center gap-2">
                                    <PlayerAvatar name={b.playerName ?? "?"} imageUrl={b.imageUrl} size="xs" />
                                    <span className={insufficient ? "text-muted-foreground" : "text-slate-200 font-semibold"}>
                                      {b.playerName ?? "Unknown"}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-1.5 pr-3 text-muted-foreground">
                                  {b.statType}
                                  <span className="ml-1 text-[10px] capitalize">{b.tier}</span>
                                </td>
                                <td className="py-1.5 px-2 text-right">
                                  {insufficient ? (
                                    <span className="text-amber-600 font-bold">{b.gradedCount}
                                      <span className="text-muted-foreground font-normal">/5</span>
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">{b.gradedCount}</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-2 text-right text-amber-600/70">
                                  {b.pendingCount > 0 ? `+${b.pendingCount}` : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className={`py-1.5 px-2 text-right font-bold ${hitColor}`}>
                                  {b.hitRate != null
                                    ? `${(b.hitRate * 100).toFixed(1)}%`
                                    : insufficient
                                      ? <span className="text-[10px] text-muted-foreground italic">{pct}% there</span>
                                      : "—"}
                                </td>
                                <td className="py-1.5 px-2 text-right text-muted-foreground">
                                  {b.avgModelPOver != null ? `${b.avgModelPOver.toFixed(1)}%` : "—"}
                                </td>
                                <td className={`py-1.5 pl-2 text-right font-bold ${deltaColor}`}>
                                  {b.delta != null ? `${b.delta > 0 ? "+" : ""}${b.delta.toFixed(1)}pp` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {insufficientPlayerBuckets.length > 0 && (
                        <p className="mt-2 text-[10px] font-mono text-slate-600">
                          {insufficientPlayerBuckets.length} bucket{insufficientPlayerBuckets.length !== 1 ? "s" : ""} building toward 5 graded picks (dimmed). Delta highlights at ±10 pp.
                        </p>
                      )}
                    </div>
                  )
                )}
              </CardContent>
            )}
          </Card>

          {/* Emotional State Performance */}
          {s.emotionWinRates && s.emotionWinRates.length > 0 && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider">Win Rate by Emotional State</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {(s.emotionWinRates as any[]).map((d: any) => (
                    <div key={d.emotion} className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <div className="text-xl mb-1">{EMOTION_EMOJI[d.emotion] ?? "🎯"}</div>
                      <div className="text-[10px] font-mono text-muted-foreground capitalize mb-1">{d.emotion}</div>
                      <div className={`text-lg font-bold font-mono ${(d.rate ?? 0) >= 0.6 ? "text-emerald-400" : (d.rate ?? 0) >= 0.5 ? "text-amber-400" : "text-rose-400"}`}>
                        {d.rate != null ? `${(d.rate * 100).toFixed(0)}%` : "—"}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">{d.wins}W / {d.total}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <div className="text-center text-muted-foreground font-mono py-20">Failed to load stats.</div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub: string; icon: any; color: string;
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between mb-2">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
          <Icon className={`w-3.5 h-3.5 ${color}`} />
        </div>
        <div className={`text-3xl font-bold font-mono ${color}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground font-mono mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
