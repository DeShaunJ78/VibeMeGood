import React, { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  useGetSlate, getGetSlateQueryKey, useGetSlateSports,
  useAddToWatchlist, useRemoveFromWatchlist, useSetPpLineOverrides,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LineTypeBadge, ActionTagBadge, POverBadge, DQBadge } from "@/components/ui/badges";
import { PropDetailSheet } from "@/components/prop-detail-sheet";
import { TeamPicksBoard } from "@/components/team-picks-board";
import { Users, User, Eye, EyeOff, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Minus, Zap, ArrowRight, Filter, ChevronDown, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell, ResponsiveContainer, AreaChart, Area } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useEntry, type EntryPick } from "@/lib/entry-context";
import { VarianceBadge } from "@/components/ui/variance-badge";
import { useUserSettings } from "@/hooks/use-user-settings";
import { PlayerAvatar } from "@/components/ui/player-avatar";

type OurProjection = {
  value: number;
  stdDev: number | null;
  p99: number | null;
  pOver: number | null;
  percentileAtLine: number | null;
  noPlayReason: string | null;
  dataQualityScore: number | null;
  sourceLabel: string | null;
  confidence: string | null;
  gamesUsed: number | null;
  shrinkageFactor: number | null;
  isStale: boolean;
  vor: number | null;
  ensembleBlendPct: 0 | 30 | 70;
  calSampleSize: number;
};

type MarketIntelRow = {
  ppLineId: number;
  playerId: number;
  playerName: string;
  imageUrl: string | null;
  teamId: number | null;
  sport: string;
  statType: string;
  lineValue: number;
  lineType: string;
  marketAvg: number | null;
  trueEdge: number | null;
  bookLines: Record<string, number>;
  bookCount: number;
  marketDataStatus: "available" | "partial" | "unavailable" | "not_synced";
  fairProb: number | null;
  marketHoldPct: number | null;
  holdRating: "low" | "moderate" | "high" | null;
  bookHolds: { book: string; holdPct: number; overPrice: number | null; underPrice: number | null }[];
  edgeScore: number | null;
  actionTag: string | null;
  ourProjection: OurProjection | null;
  streak: { count: number; type: string | null } | null;
  recentMoves: { book: string; from: unknown; to: unknown; direction: string | null; at: unknown }[];
  sharpSignal:      "sharp" | "public" | "neutral" | null;
  sharpConfidence:  "low" | "medium" | "high" | null;
  sharpExplanation: string | null;
  sharpSide:        "over" | "under" | null;
  sharpPublicPct:   number | null;
  scoring: Record<string, unknown> | null;
  variance: {
    volatilityRating: string | null;
    blowoutRisk: number | null;
    fatigueScore: number | null;
    usageScore: number | null;
    matchupScore: number | null;
    environmentScore: number | null;
    warnings: string[] | null;
    evModifier: unknown;
    whyItMoves: string | null;
  } | null;
  calibrationCount: number;
  gameLogs: number[];
};

type MarketIntelPage = {
  data: MarketIntelRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  lastOddsSync?: string | null;
};

function useMarketIntel(params: Record<string, string | undefined>, page: number, enabled = true) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  qs.set("page", String(page));
  qs.set("limit", "100");
  return useQuery<MarketIntelPage>({
    queryKey: ["market-intel", params, page],
    queryFn: async () => {
      const r = await fetch(`${base}/api/market-intel?${qs}`);
      if (!r.ok) throw new Error("market-intel fetch failed");
      return r.json();
    },
    staleTime: 60_000,
    enabled,
  });
}

function SyncProjectionsButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  async function syncProj() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch(`${base}/api/admin/sync/projections`, { method: "POST" });
      const data = await res.json() as { matched?: number; upserted?: number; error?: string };
      if (data.error) throw new Error(data.error);
      const label = `${data.upserted ?? data.matched ?? 0} projections`;
      setResult(label);
      toast({ title: "Projections synced", description: label });
      void qc.invalidateQueries();
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        size="sm" variant="outline" onClick={syncProj} disabled={syncing}
        title={result ? `Last sync: ${result}` : "Sync FP/NHL projections"}
        className="gap-1.5 font-mono text-xs border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
      >
        <Zap className={`w-3 h-3 ${syncing ? "animate-pulse" : ""}`} />
        {syncing ? "Syncing…" : "Sync Proj"}
      </Button>
      {result && (
        <span className="text-[10px] font-mono text-violet-400">{result}</span>
      )}
    </div>
  );
}

function ForceSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  useEffect(() => {
    if (!syncing) return;
    const es = new EventSource(`${base}/api/events`);
    es.addEventListener("sync_status", (e) => {
      const { job, status } = JSON.parse(e.data) as { job: string; status: string };
      if (status === "running") setSyncStep(`${job}…`);
      if (job === "all" && status === "success") {
        setSyncing(false);
        setSyncStep(null);
        void qc.invalidateQueries();
        es.close();
      }
      if (status === "error") setSyncStep(`${job} failed`);
    });
    return () => es.close();
  }, [syncing, base, qc]);

  async function forceSync() {
    setSyncing(true);
    setSyncStep("starting…");
    try {
      await fetch(`${base}/api/sync/all`, { method: "POST" });
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
      setSyncing(false);
      setSyncStep(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        size="sm" variant="outline" onClick={forceSync} disabled={syncing}
        className="gap-1.5 font-mono text-xs border-primary/30 text-primary hover:bg-primary/10"
      >
        <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing…" : "Force Sync"}
      </Button>
      {syncStep && (
        <span className="text-[10px] font-mono text-muted-foreground">{syncStep}</span>
      )}
    </div>
  );
}

function SyncOddsButton({ onDone }: { onDone?: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  async function syncOdds() {
    setSyncing(true);
    try {
      const res = await fetch(`${base}/api/sync/external-odds`, { method: "POST" });
      if (!res.ok) throw new Error("sync failed");
      toast({ title: "Odds synced", description: "External odds data refreshed." });
      await qc.invalidateQueries({ queryKey: ["market-intel"] });
      onDone?.();
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button
      size="sm" variant="outline" onClick={syncOdds} disabled={syncing}
      className="gap-1.5 font-mono text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
    >
      <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "Syncing…" : "Sync Odds"}
    </Button>
  );
}

function MarketStatusDot({ status }: { status: MarketIntelRow["marketDataStatus"] }) {
  const cfg: Record<string, { color: string; label: string }> = {
    available:   { color: "bg-emerald-400", label: "Live market data (< 30 min)" },
    partial:     { color: "bg-amber-400",   label: "Partial market data (1 book or stale)" },
    unavailable: { color: "bg-rose-400",    label: "Market data synced but no matching lines" },
    not_synced:  { color: "bg-slate-500",   label: "Never synced — run Force Sync" },
  };
  const c = cfg[status] ?? cfg.not_synced;
  return <span title={c.label} className={`inline-block w-1.5 h-1.5 rounded-full ${c.color} mr-0.5 shrink-0`} />;
}

function ProjectionCell({ proj, ppLine }: { proj: OurProjection | null; ppLine: number }) {
  if (!proj) return <span className="text-slate-600 text-xs font-mono">—</span>;

  const gap = proj.value - ppLine;
  const gapColor = gap > 0 ? "text-emerald-400" : gap < 0 ? "text-rose-400" : "text-slate-400";
  const GapIcon = gap > 0.5 ? TrendingUp : gap < -0.5 ? TrendingDown : Minus;

  const tooltipContent = [
    `Model: ${proj.sourceLabel ?? "prior_only"}`,
    proj.gamesUsed != null ? `${proj.gamesUsed} games used` : null,
    proj.shrinkageFactor != null ? `Shrinkage: ${Math.round(proj.shrinkageFactor * 100)}%` : null,
    proj.stdDev != null ? `σ = ${proj.stdDev}` : null,
  ].filter(Boolean).join(" · ");

  const showLowConf = proj.gamesUsed != null && proj.gamesUsed < 5;
  const showMed     = proj.gamesUsed != null && proj.gamesUsed >= 5 && proj.gamesUsed < 20;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-end gap-1 cursor-help">
          <span className="font-mono text-xs text-violet-300">{proj.value.toFixed(1)}</span>
          <span className={`font-mono text-[10px] ${gapColor} flex items-center gap-0.5`}>
            <GapIcon className="w-2.5 h-2.5" />
            {gap > 0 ? "+" : ""}{gap.toFixed(1)}
          </span>
          {showLowConf && (
            <span className="text-[8px] font-mono text-amber-400 bg-amber-950/40 border border-amber-800/40 rounded px-0.5 leading-tight shrink-0">LOW</span>
          )}
          {showMed && (
            <span className="text-[8px] font-mono text-slate-500 leading-tight">MED</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-xs max-w-xs">
        <p>{tooltipContent}</p>
        {showLowConf && <p className="text-amber-400 mt-0.5">LOW CONFIDENCE — only {proj.gamesUsed} game{proj.gamesUsed !== 1 ? "s" : ""} of data</p>}
        {showMed && <p className="text-slate-400 mt-0.5">MED — {proj.gamesUsed} games used, growing sample</p>}
        {proj.stdDev && <p className="text-slate-400 mt-0.5">±1σ: [{(proj.value - proj.stdDev).toFixed(1)}, {(proj.value + proj.stdDev).toFixed(1)}]</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function WatchToggle({ row, slateParams }: { row: any; slateParams: Record<string, any> }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const busy = add.isPending || remove.isPending;

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (row.isWatched && row.watchlistId != null) {
        await remove.mutateAsync({ id: row.watchlistId });
        toast({ title: "Removed from watchlist", description: row.playerName });
      } else {
        await add.mutateAsync({ data: { playerId: row.playerId, statType: row.statType } });
        toast({ title: "Added to watchlist", description: row.playerName });
      }
      await qc.invalidateQueries({ queryKey: getGetSlateQueryKey(slateParams) });
      await qc.invalidateQueries({ queryKey: ["market-intel"] });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  return (
    <Button
      size="icon" variant="ghost" onClick={toggle} disabled={busy}
      className={`h-6 w-6 rounded shrink-0 transition-colors ${row.isWatched ? "text-amber-400 hover:text-amber-300" : "text-slate-600 hover:text-slate-400"}`}
    >
      {row.isWatched ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
    </Button>
  );
}

const POWER_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };

interface OptResult {
  ppLineId: number;
  playerId: number;
  playerName: string;
  imageUrl: string | null;
  teamAbbr: string | null;
  statType: string;
  lineValue: number;
  lineType: string;
  pOver: number;
  ev: number;
  edgeScore: number | null;
  actionTag: string | null;
  ourProjection: OurProjection | null;
}

const POSITION_ORDER: Record<string, string[]> = {
  NBA: ["PG", "SG", "SF", "PF", "C"],
  NFL: ["QB", "RB", "WR", "TE", "K"],
  MLB: ["P", "C", "1B", "2B", "3B", "SS", "OF"],
  NHL: ["C", "LW", "RW", "D", "G"],
};

function positionOrder(sport: string): string[] {
  return POSITION_ORDER[sport.toUpperCase()] ?? [];
}

type SortDir = "asc" | "desc";

function SortTh({
  col, label, sortCol, sortDir, onSort, className = "", children,
}: {
  col: string; label?: string; sortCol: string; sortDir: SortDir;
  onSort: (c: string) => void; className?: string; children?: ReactNode;
}) {
  const active = sortCol === col;
  return (
    <TableHead
      onClick={() => onSort(col)}
      className={`cursor-pointer select-none hover:text-foreground font-mono text-xs ${className}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {children ?? label}
        {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </span>
    </TableHead>
  );
}

// ─── Quick-filter presets ────────────────────────────────────────────────────
type Preset = { label: string; icon: string; sport?: string; lineType?: string; minEdge?: string; actionTag?: string; sharpOnly?: boolean };
const DEFAULT_PRESETS: Preset[] = [
  { label: "Safe",      icon: "🛡", actionTag: "PLAY" },
  { label: "Upside",    icon: "🚀", minEdge: "62" },
  { label: "Late-News", icon: "📰", sharpOnly: true },
  { label: "My Style",  icon: "⭐" },
];
const PRESET_LS_KEY = "vmg_filter_presets";

// ─── Inline chart helpers for expandable rows ────────────────────────────────
function normalPdf(x: number, mu: number, sigma: number) {
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
}

function MiniGameChart({ values, ppLine }: { values: number[]; ppLine: number }) {
  if (!values.length) return <span className="text-slate-600 text-xs font-mono">no data</span>;
  const data = [...values].reverse().map((v, i) => ({ g: i + 1, v, over: v > ppLine }));
  const hitRate = Math.round(data.filter(d => d.over).length / data.length * 100);
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-500 uppercase">Recent form (L{data.length})</span>
        <span className={`text-[10px] font-mono font-bold ${hitRate >= 55 ? "text-emerald-400" : hitRate >= 45 ? "text-amber-400" : "text-rose-400"}`}>{hitRate}% over</span>
      </div>
      <ResponsiveContainer width="100%" height={64}>
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="g" tick={false} axisLine={false} />
          <YAxis domain={["auto", "auto"]} tick={false} axisLine={false} width={0} />
          <ReferenceLine y={ppLine} stroke="#64748b" strokeDasharray="3 3" strokeWidth={1} />
          <Bar dataKey="v" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {data.map((e, i) => <Cell key={i} fill={e.over ? "#34d399" : "#f87171"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HitRateChart({ values, ppLine }: { values: number[]; ppLine: number }) {
  if (!values.length) return <span className="text-slate-600 text-xs font-mono">no data</span>;
  const hits = values.filter(v => v > ppLine).length;
  const rate = Math.round((hits / values.length) * 100);
  const barColor = rate >= 60 ? "#34d399" : rate >= 50 ? "#fbbf24" : "#f87171";
  const data = [{ rate, miss: 100 - rate }];
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-500 uppercase">Hit Rate (L{values.length})</span>
        <span className="text-[10px] font-mono font-bold" style={{ color: barColor }}>{rate}%</span>
      </div>
      <ResponsiveContainer width="100%" height={64}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <XAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <YAxis type="category" dataKey="name" hide />
          <ReferenceLine x={60} stroke="#64748b" strokeDasharray="3 3" strokeWidth={1} />
          <Bar dataKey="rate" stackId="a" fill={barColor} radius={[2, 0, 0, 2]} isAnimationActive={false} />
          <Bar dataKey="miss" stackId="a" fill="#1e293b" radius={[0, 2, 2, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-[9px] font-mono text-slate-600">
        <span>0%</span><span className="text-slate-500">60% threshold</span><span>100%</span>
      </div>
    </div>
  );
}

function DistributionChart({ mean, stdDev, ppLine }: { mean: number; stdDev: number; ppLine: number }) {
  const lo = mean - 3.2 * stdDev;
  const hi = mean + 3.2 * stdDev;
  const step = (hi - lo) / 50;
  const data = Array.from({ length: 51 }, (_, i) => ({ x: Math.round((lo + i * step) * 10) / 10, pdf: normalPdf(lo + i * step, mean, stdDev) }));
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-mono text-slate-500 uppercase">Distribution</span>
      <ResponsiveContainer width="100%" height={64}>
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="x" tick={false} axisLine={false} />
          <YAxis hide />
          <ReferenceLine x={ppLine} stroke="#22d3ee" strokeDasharray="3 3" strokeWidth={1.5} />
          <Area type="monotone" dataKey="pdf" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.25} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t*Math.exp(-x*x);
  return sign * y;
}

function classifyTier(lineVal: number, proj: number): "goblin" | "standard" | "demon" {
  const ratio = lineVal / proj;
  if (ratio < 0.6) return "goblin";
  if (ratio > 1.2) return "demon";
  return "standard";
}

function normalCDF(mean: number, std: number, line: number): number {
  if (std <= 0) return line < mean ? 1 : 0;
  const z = (line - mean) / (std * Math.sqrt(2));
  return (1 - erf(z)) / 2;
}

export default function SlateBoard() {
  const qc = useQueryClient();
  const { data: userSettings } = useUserSettings();
  const { data: allEntriesForCount } = useQuery<{ length: number }>({
    queryKey: ["entries-total-count"],
    queryFn: async () => {
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const r = await fetch(`${base}/api/entries`);
      const arr = (await r.json()) as unknown[];
      return { length: Array.isArray(arr) ? arr.length : 0 };
    },
    staleTime: 60_000,
  });
  const totalEntries = allEntriesForCount?.length ?? 0;
  const presetsUnlocked = totalEntries >= 30;
  const varianceEnabled = userSettings?.varianceIntelEnabled ?? false;
  const [tab, setTab] = useState<"player" | "team">("player");
  // "" = unresolved; auto-defaults to the most-populated sport once counts load.
  // Persists the user's manual choice across sessions.
  const [sport, setSport] = useState<string>(() => {
    try { return localStorage.getItem("slate-sport") ?? ""; } catch { return ""; }
  });
  const [lineTypeFilter, setLineTypeFilter] = useState<string>("all");
  const [minEdge, setMinEdge] = useState<string>("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [actionTagFilter, setActionTagFilter] = useState<string>("all");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const activeFilterCount = [sport !== "all" && sport, lineTypeFilter !== "all" && lineTypeFilter, minEdge, actionTagFilter !== "all" && actionTagFilter].filter(Boolean).length;
  const [optPickCount, setOptPickCount] = useState(4);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sharpOnly, setSharpOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(75);
  const [sortCol, setSortCol] = useState<string>("projGap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lastOddsSync, setLastOddsSync] = useState<string | null | undefined>(undefined);
  // Line corrections + demon/goblin payout multipliers persist server-side, keyed by
  // ppLineId so a standard-line fix never bleeds onto its goblin/demon siblings, and the
  // optimizer sees the same corrections.
  const setOverride = useSetPpLineOverrides();
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const oddsStale = lastOddsSync !== undefined && (
    lastOddsSync === null ||
    Date.now() - new Date(lastOddsSync).getTime() > 4 * 60 * 60 * 1000
  );

  const { data: preLockStatus } = useQuery<{ preLockActive: boolean }>({
    queryKey: ["pre-lock-status"],
    queryFn: async () => {
      const b = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const r = await fetch(`${b}/api/system-health/pre-lock`);
      return r.json() as Promise<{ preLockActive: boolean }>;
    },
    refetchInterval: 60_000,
  });

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const OPT_KEY    = "pp_opt_results";
  const OPT_TS_KEY = "pp_opt_ts";
  const OPT_TTL    = 6 * 60 * 60 * 1000;

  const [optResults, setOptResults] = useState<OptResult[]>(() => {
    try {
      const s = localStorage.getItem(OPT_KEY);
      const t = localStorage.getItem(OPT_TS_KEY);
      if (s && t && Date.now() - Number(t) < OPT_TTL) return JSON.parse(s);
    } catch {}
    return [];
  });
  const [optLoaded, setOptLoaded] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(OPT_KEY);
      const t = localStorage.getItem(OPT_TS_KEY);
      return !!(s && t && Date.now() - Number(t) < OPT_TTL);
    } catch {}
    return false;
  });
  const { addPick, hasPick } = useEntry();

  const slateParams = {
    sport: sport !== "all" ? sport : undefined,
  };

  const saveOverride = useCallback(
    (ppLineId: number, patch: { lineValueOverride?: number | null; payoutMultiplier?: number | null }) => {
      setOverride.mutate(
        { id: ppLineId, data: patch },
        { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetSlateQueryKey(slateParams) }); } },
      );
    },
    [setOverride, qc, slateParams],
  );

  const miParams: Record<string, string | undefined> = {
    sport: sport !== "all" ? sport : undefined,
    lineType: lineTypeFilter !== "all" ? lineTypeFilter : undefined,
    actionTag: actionTagFilter !== "all" ? actionTagFilter : undefined,
    search: searchQuery || undefined,
  };

  // Pagination state for market-intel
  const [miPage, setMiPage] = useState(1);
  const [allMiRows, setAllMiRows] = useState<MarketIntelRow[]>([]);
  const [miTotal, setMiTotal] = useState(0);
  const [miHasMore, setMiHasMore] = useState(false);

  // Reset pagination when filters change
  const miParamsStr = JSON.stringify(miParams);
  const prevMiParamsStr = useRef(miParamsStr);
  useEffect(() => {
    if (prevMiParamsStr.current !== miParamsStr) {
      prevMiParamsStr.current = miParamsStr;
      setMiPage(1);
      setAllMiRows([]);
      setMiTotal(0);
      setMiHasMore(false);
    }
  }, [miParamsStr]);

  // Active-line counts per sport — used to auto-pick the most-populated sport
  // so the board is never empty (off-season) nor overloaded (all sports).
  const { data: sportCounts, isSuccess: sportsLoaded, isError: sportsError } = useGetSlateSports();
  const sportResolved = sport !== "";
  useEffect(() => {
    if (sport !== "") return;
    if (sportCounts && sportCounts.length > 0) {
      setSport(sportCounts[0].sport);
    } else if (sportsLoaded || sportsError) {
      // Counts query finished but returned nothing (off-season / no active lines
      // / fetch error). Fall back to a concrete sport so the query stays
      // sport-scoped (never all-sports) and the skeleton stops loading.
      setSport("MLB");
    }
  }, [sportCounts, sport, sportsLoaded, sportsError]);

  // Persist the user's resolved sport choice across sessions.
  useEffect(() => {
    if (sport !== "") { try { localStorage.setItem("slate-sport", sport); } catch {} }
  }, [sport]);

  const { data: slate, isLoading: slateLoading } = useGetSlate(slateParams, {
    query: { queryKey: getGetSlateQueryKey(slateParams), enabled: sportResolved },
  });

  const { data: miPageData, isLoading: miLoading } = useMarketIntel(miParams, miPage, sportResolved);

  // Accumulate pages as they load; capture lastOddsSync from page 1
  useEffect(() => {
    if (!miPageData) return;
    if (miPage === 1) setLastOddsSync(miPageData.lastOddsSync ?? null);
    setAllMiRows(prev => miPage === 1 ? miPageData.data : [...prev, ...miPageData.data]);
    setMiTotal(miPageData.total);
    setMiHasMore(miPageData.hasMore);
  }, [miPageData, miPage]);

  // Only block on skeleton for the very first page
  const isLoading = !sportResolved || slateLoading || (miPage === 1 && miLoading);

  // Merge market-intel into slate rows by ppLineId
  const miMap = new Map<number, MarketIntelRow>(allMiRows.map(r => [r.ppLineId, r]));

  const mergedRows = (slate ?? []).map((row: any) => {
    const mi = miMap.get(row.ppLineId);
    return {
      ...row,
      marketAvg: mi?.marketAvg ?? null,
      trueEdge: mi?.trueEdge ?? null,
      bookLines: mi?.bookLines ?? {},
      bookCount: mi?.bookCount ?? 0,
      marketDataStatus: mi?.marketDataStatus ?? "not_synced",
      edgeScore: mi?.edgeScore ?? row.edgeScore,
      actionTag: mi?.actionTag ?? row.actionTag,
      ourProjection: mi?.ourProjection ?? null,
      streak: mi?.streak ?? null,
      recentMoves: mi?.recentMoves ?? [],
      sharpSignal:      (mi?.sharpSignal      ?? null) as "sharp" | "public" | "neutral" | null,
      sharpConfidence:  (mi?.sharpConfidence  ?? null) as "low" | "medium" | "high" | null,
      sharpExplanation: mi?.sharpExplanation ?? null,
      sharpSide:        (mi?.sharpSide        ?? null) as "over" | "under" | null,
      sharpPublicPct:   mi?.sharpPublicPct   ?? null,
      scoring: mi?.scoring ?? null,
      variance: mi?.variance ?? null,
      fairProb: mi?.fairProb ?? null,
      marketHoldPct: mi?.marketHoldPct ?? null,
      holdRating: mi?.holdRating ?? null,
      bookHolds: mi?.bookHolds ?? [],
      calibrationCount: mi?.calibrationCount ?? 0,
    };
  });

  // Watch state is authoritative on the slate rows (the API computes isWatched +
  // watchlistId per playerId:statType). Build a lookup so market-intel-only rows
  // — and any row chosen by the dedup below — reflect the real watch state instead
  // of defaulting to unwatched. Without this, the dedup can collapse a watched
  // slate row onto an unwatched MI-only row, leaving the toggle stuck in "add"
  // mode so the player can never be un-watched.
  const watchStateByKey = new Map<string, { isWatched: boolean; watchlistId: number | null }>();
  for (const r of (slate ?? []) as any[]) {
    if (r.isWatched && r.watchlistId != null) {
      watchStateByKey.set(`${r.playerId}:${r.statType}`, { isWatched: true, watchlistId: r.watchlistId });
    }
  }

  // Market-intel rows not in slate (new from live sync)
  const slateIds = new Set((slate ?? []).map((r: any) => r.ppLineId));
  const miOnlyRows: any[] = (allMiRows ?? [])
    .filter(mi => !slateIds.has(mi.ppLineId))
    .map(mi => ({
      ppLineId: mi.ppLineId,
      playerId: mi.playerId,
      playerName: mi.playerName,
      teamAbbr: null,
      opponentAbbr: null,
      sport: mi.sport,
      statType: mi.statType,
      lineValue: mi.lineValue,
      lineType: mi.lineType,
      pickCategory: "player",
      isWatched: watchStateByKey.get(`${mi.playerId}:${mi.statType}`)?.isWatched ?? false,
      watchlistId: watchStateByKey.get(`${mi.playerId}:${mi.statType}`)?.watchlistId ?? null,
      marketAvg: mi.marketAvg,
      trueEdge: mi.trueEdge,
      bookLines: mi.bookLines,
      bookCount: mi.bookCount,
      marketDataStatus: mi.marketDataStatus,
      edgeScore: mi.edgeScore,
      actionTag: mi.actionTag,
      ourProjection: mi.ourProjection,
      streak: mi.streak,
      recentMoves: mi.recentMoves,
      sharpSignal:      (mi.sharpSignal      ?? null) as "sharp" | "public" | "neutral" | null,
      sharpConfidence:  (mi.sharpConfidence  ?? null) as "low" | "medium" | "high" | null,
      sharpExplanation: mi.sharpExplanation ?? null,
      sharpSide:        (mi.sharpSide        ?? null) as "over" | "under" | null,
      sharpPublicPct:   mi.sharpPublicPct   ?? null,
      scoring: mi.scoring,
      variance: mi.variance ?? null,
      fairProb: mi.fairProb ?? null,
      marketHoldPct: mi.marketHoldPct ?? null,
      holdRating: mi.holdRating ?? null,
      bookHolds: mi.bookHolds ?? [],
      calibrationCount: mi.calibrationCount,
    }));

  const allRows = [...mergedRows, ...miOnlyRows];
  const teamRows = allRows.filter((r) => r.pickCategory === "team");
  const notSynced = allMiRows.length === 0 && !miLoading && sport === "all";

  const playerRows = useMemo(() => {
    let rows = allRows.filter((r) => r.pickCategory !== "team");
    if (lineTypeFilter !== "all") rows = rows.filter(r => r.lineType === lineTypeFilter);
    if (minEdge) rows = rows.filter(r => r.edgeScore != null && r.edgeScore >= parseFloat(minEdge));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(r =>
        r.playerName.toLowerCase().includes(q) ||
        (r.teamAbbr ?? "").toLowerCase().includes(q)
      );
    }
    // Deduplicate — one row per (playerId, statType) — ONLY in the "All" tier view, so the
    // default board isn't flooded. When a specific tier (standard/demon/goblin) is selected
    // from the dropdown, show EVERY rung of that tier (the full risk ladder).
    if (lineTypeFilter === "all") {
    const dedupMap = new Map<string, typeof rows[0]>();

    for (const r of rows) {
      const key = `${r.playerId}:${r.statType}`;
      const prev = dedupMap.get(key);

      const getTierScore = (row: typeof r): number => {
        const line = row.lineValue ?? 0;
        const proj = row.ourProjection?.value ?? null;

        // Priority 1: any book/platform anchor exists — prefer tier closest to
        // the market consensus line (marketAvg = avg of sportsbooks + Underdog).
        // This correctly anchors combo stats via Underdog even when no sharp-book
        // odds exist, since all tiers share the same bookCount from platform data.
        if ((row.bookCount ?? 0) > 0) {
          if (row.marketAvg != null) {
            const distance = Math.abs(line - row.marketAvg);
            // Score: 2000 minus distance in half-points; exact match = 2000.
            return 2000 - Math.round(distance * 2);
          }
          return 1500 + (row.finalScore ?? 0);
        }

        // Priority 2: standard tier (within 60–120% of projection)
        if (proj && proj > 0) {
          const tier = classifyTier(line, proj);
          if (tier === "standard")
            return 500 + line;
        }

        // Priority 3: fallback to finalScore
        return row.finalScore ?? 0;
      };

      if (!prev) {
        dedupMap.set(key, r);
      } else {
        if (getTierScore(r) > getTierScore(prev)) {
          dedupMap.set(key, r);
        }
      }
    }
    rows = Array.from(dedupMap.values());
    }

    if (sharpOnly) {
      rows = rows.filter(r => r.sharpSignal === "sharp");
    }

    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "playerName": cmp = (a.playerName ?? "").localeCompare(b.playerName ?? ""); break;
        case "statType":   cmp = (a.statType ?? "").localeCompare(b.statType ?? ""); break;
        case "ppLine":     cmp = (a.lineValueOverride ?? a.lineValue ?? 0) - (b.lineValueOverride ?? b.lineValue ?? 0); break;
        case "ourProj":    cmp = (a.ourProjection?.value ?? -1) - (b.ourProjection?.value ?? -1); break;
        case "projGap": {
          const ga = a.ourProjection ? a.ourProjection.value - (a.lineValueOverride ?? a.lineValue) : -999;
          const gb = b.ourProjection ? b.ourProjection.value - (b.lineValueOverride ?? b.lineValue) : -999;
          cmp = ga - gb; break;
        }
        case "vor":      cmp = (a.ourProjection?.vor ?? -999) - (b.ourProjection?.vor ?? -999); break;
        case "pOver":    cmp = (a.ourProjection?.pOver ?? -1) - (b.ourProjection?.pOver ?? -1); break;
        case "trueEdge": cmp = (a.trueEdge ?? -999) - (b.trueEdge ?? -999); break;
        case "position": {
          const order = positionOrder(a.sport ?? "");
          const ai = order.indexOf((a.position ?? "").toUpperCase());
          const bi = order.indexOf((b.position ?? "").toUpperCase());
          cmp = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          break;
        }
        case "fatigue":  cmp = (a.variance?.fatigueScore ?? 0) - (b.variance?.fatigueScore ?? 0); break;
        case "blowout":  cmp = (a.variance?.blowoutRisk ?? 0) - (b.variance?.blowoutRisk ?? 0); break;
        default:
          cmp = (a.ourProjection?.pOver ?? -1) - (b.ourProjection?.pOver ?? -1);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [allRows, lineTypeFilter, minEdge, searchQuery, sortCol, sortDir, sharpOnly]);

  const watchCount  = useMemo(() => playerRows.filter(r => r.isWatched).length,   [playerRows]);
  const noPlayCount = useMemo(() => playerRows.filter(r => r.actionTag === "NO-PLAY").length, [playerRows]);
  const playCount   = useMemo(() => playerRows.filter(r => r.actionTag === "PLAY").length,    [playerRows]);
  const visibleRows = useMemo(() => playerRows.slice(0, visibleCount), [playerRows, visibleCount]);

  const { data: betterLinesData = [] } = useQuery<Array<{
    ppLineId: number;
    bestPlatform: string;
    bestLineValue: number;
  }>>({
    queryKey: ["platform-lines-better"],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const r = await fetch(`${base}/api/platform-lines/better-lines`);
      return r.ok ? (r.json() as Promise<Array<{ ppLineId: number; bestPlatform: string; bestLineValue: number }>>) : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const betterLineMap = useMemo(() => {
    const m = new Map<number, { platform: string; lineValue: number }>();
    for (const b of betterLinesData) m.set(b.ppLineId, { platform: b.bestPlatform, lineValue: b.bestLineValue });
    return m;
  }, [betterLinesData]);

  function getEffectiveLine(row: typeof playerRows[0]): number {
    return row.lineValueOverride ?? row.effectiveLine ?? row.lineValue ?? 0;
  }

  function hasOverride(row: typeof playerRows[0]): boolean {
    return row.lineValueOverride != null;
  }

  function getOverridePOver(row: typeof playerRows[0]): number | null {
    const override = row.lineValueOverride;
    if (override == null) return null;
    const proj = row.ourProjection;
    if (!proj?.value) return null;
    const std = proj.stdDev && proj.stdDev > 0
      ? proj.stdDev
      : proj.value * 0.30;
    return Math.round(
      normalCDF(proj.value, std, override)
      * 100 * 10) / 10;
  }

  type TonightPace = {
    gameId: number;
    homeTeamId: number;
    awayTeamId: number;
    estimatedGamePace: number;
    paceLabel: string;
    paceAdjustment: number;
    paceColor: string;
  };
  const { data: paceGames = [] } = useQuery<TonightPace[]>({
    queryKey: ["pace-tonight"],
    queryFn: async (): Promise<TonightPace[]> => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const r = await fetch(`${base}/api/pace/tonight`);
      return r.ok ? (r.json() as Promise<TonightPace[]>) : [];
    },
    staleTime: 10 * 60 * 1000,
  });

  const paceMap = useMemo(() => {
    const m = new Map<number, { estimatedGamePace: number; paceLabel: string; paceAdjustment: number; paceColor: string }>();
    for (const g of paceGames) {
      const info = { estimatedGamePace: g.estimatedGamePace, paceLabel: g.paceLabel, paceAdjustment: g.paceAdjustment, paceColor: g.paceColor };
      m.set(g.homeTeamId, info);
      m.set(g.awayTeamId, info);
    }
    return m;
  }, [paceGames]);

  type NflAdvRow = {
    playerName: string;
    snapPct: number | null;
    targetShare: number | null;
    wopr: number | null;
    position: string | null;
  };
  const { data: nflAdvData = [] } = useQuery<NflAdvRow[]>({
    queryKey: ["nfl-advanced-slate"],
    queryFn: async (): Promise<NflAdvRow[]> => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const r = await fetch(`${base}/api/nfl-advanced/slate`);
      return r.ok ? (r.json() as Promise<NflAdvRow[]>) : [];
    },
    staleTime: 60 * 60 * 1000,
  });

  const nflAdvMap = useMemo(() => {
    const m = new Map<string, NflAdvRow>();
    for (const row of nflAdvData) m.set(row.playerName.toLowerCase(), row);
    return m;
  }, [nflAdvData]);

  const isNflSlate = sport === "NFL";

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 150);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setVisibleCount(75); }, [lineTypeFilter, minEdge, sport, searchQuery, sortCol]);

  const runOptimizer = useCallback(() => {
    const multiplier = POWER_MULTIPLIERS[optPickCount] ?? 10;
    const modes = (userSettings?.varianceModes ?? {}) as Record<string, boolean>;

    // Apply variance-mode filters when variance intel is enabled
    const stableGrind    = varianceEnabled && modes.stablePicksOnly;
    const ceilingHunter  = varianceEnabled && modes.ceilingHunterMode;
    const excludeVolatile = varianceEnabled && modes.excludeHighVolatility;

    // Fix 2: exclude prior-only / insufficient-data props from optimizer recommendations.
    // Requires noPlayReason to be unset AND at least 5 game logs.
    let candidates = playerRows.filter(
      r =>
        r.lineType === "goblin" &&
        r.ourProjection?.pOver != null &&
        r.ourProjection.pOver > 50 &&
        r.ourProjection?.noPlayReason == null &&
        r.ourProjection?.gamesUsed != null &&
        r.ourProjection.gamesUsed >= 5,
    );

    if (stableGrind) {
      // Stable Grind: remove high/boom_bust volatility, back-to-back players, blowoutRisk > 35
      candidates = candidates.filter(r => {
        const v = r.variance;
        if (!v) return true; // no variance data — keep
        if (v.volatilityRating === "high" || v.volatilityRating === "boom_bust") return false;
        if (v.warnings?.includes("back_to_back")) return false;
        if ((v.blowoutRisk ?? 0) > 35) return false;
        return true;
      });
    } else if (excludeVolatile) {
      // Exclude High Volatility: remove high/boom_bust props
      candidates = candidates.filter(r => {
        const v = r.variance;
        if (!v) return true;
        return v.volatilityRating !== "high" && v.volatilityRating !== "boom_bust";
      });
    }

    const goblinProps = (ceilingHunter
      // Ceiling Hunter: prioritise usage spikes first
      ? candidates.sort((a, b) => ((b.variance?.usageScore ?? 0) - (a.variance?.usageScore ?? 0)))
      : candidates.sort((a, b) => (b.ourProjection?.pOver ?? 0) - (a.ourProjection?.pOver ?? 0))
    ).slice(0, optPickCount);

    const results: OptResult[] = goblinProps.map(r => {
      const pOver = (r.ourProjection?.pOver ?? 50) / 100;
      const stake = 25;
      const ev = pOver * multiplier * stake - stake;
      return {
        ppLineId: r.ppLineId,
        playerId: r.playerId,
        playerName: r.playerName,
        imageUrl: r.imageUrl ?? null,
        teamAbbr: r.teamAbbr ?? null,
        statType: r.statType,
        lineValue: r.lineValue,
        lineType: r.lineType,
        pOver: r.ourProjection?.pOver ?? 50,
        ev,
        edgeScore: r.edgeScore ?? null,
        actionTag: r.actionTag ?? null,
        ourProjection: r.ourProjection ?? null,
      };
    });

    setOptResults(results);
    setOptLoaded(true);
    setOptimizerOpen(true);
    try {
      localStorage.setItem(OPT_KEY, JSON.stringify(results));
      localStorage.setItem(OPT_TS_KEY, String(Date.now()));
    } catch {}
  }, [playerRows, optPickCount, userSettings, varianceEnabled]);

  function loadOptimizerToEntry() {
    for (const r of optResults) {
      if (!hasPick(r.ppLineId)) {
        addPick({
          ppLineId: r.ppLineId,
          playerId: r.playerId,
          playerName: r.playerName,
          imageUrl: r.imageUrl ?? null,
          teamAbbr: (r as any).teamAbbr ?? null,
          statType: r.statType,
          lineValue: r.lineValue,
          lineType: r.lineType,
          direction: "more",
          yourProjection: r.ourProjection?.value ?? null,
          p99: r.ourProjection?.p99 ?? null,
          pOver: r.ourProjection?.pOver ?? null,
          edgeScore: r.edgeScore,
          actionTag: r.actionTag,
        } satisfies EntryPick);
      }
    }
    setOptimizerOpen(false);
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="space-y-3 border-b border-border pb-4 shrink-0">
        {/* Row 1: title + tabs (left) · status badges / mobile controls (right) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight mr-4">Slates</h1>
            <button
              onClick={() => setTab("player")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono transition-colors ${tab === "player" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground bg-slate-800/50"}`}
            >
              <User className="w-3.5 h-3.5" /> Player Picks
              {tab === "player" && playerRows.length > 0 && (
                <span className="ml-1 bg-primary-foreground/20 text-xs px-1.5 rounded-full font-mono">{playerRows.length}</span>
              )}
            </button>
            <button
              onClick={() => setTab("team")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono transition-colors ${tab === "team" ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground bg-slate-800/50"}`}
            >
              <Users className="w-3.5 h-3.5" /> Team Picks
              <Badge className="ml-1 bg-violet-700 text-white text-[10px] px-1 py-0 font-mono">NEW</Badge>
            </button>
          </div>

          {tab === "player" && (
            <div className="flex items-center gap-2 shrink-0">
              {/* desktop status badges */}
              <div className="hidden md:flex items-center gap-2">
                {watchCount > 0 && (
                  <Badge className="font-mono text-xs bg-amber-900/40 text-amber-300 border border-amber-700/40 px-2 py-0.5">
                    <Eye className="w-3 h-3 mr-1 inline" />{watchCount} watched
                  </Badge>
                )}
                {playCount > 0 && (
                  <Badge className="font-mono text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 px-2 py-0.5">
                    {playCount} PLAY
                  </Badge>
                )}
                {noPlayCount > 0 && (
                  <Badge className="font-mono text-xs bg-rose-900/40 text-rose-300 border border-rose-700/40 px-2 py-0.5">
                    {noPlayCount} gated
                  </Badge>
                )}
              </div>
              {/* mobile filter toggle + sync */}
              <div className="md:hidden flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setFilterOpen(true)} className="gap-1.5 font-mono text-xs border-slate-700 text-muted-foreground">
                  <Filter className="w-3.5 h-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold">{activeFilterCount}</span>
                  )}
                </Button>
                <ForceSyncButton />
              </div>
            </div>
          )}
        </div>

        {tab === "player" && (
          <>

            {/* Quick-filter preset toolbar — only once unlocked (no locked-state noise) */}
            {presetsUnlocked && (
            <div className="hidden md:flex items-center gap-1.5 flex-wrap py-0.5">
              <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Quick:</span>
              {DEFAULT_PRESETS.map(p => {
                const isActive = activePreset === p.label;
                const getSaved = () => { try { return (JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>)[p.label] ?? null; } catch { return null; } };
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      if (isActive) { setSport("all"); setLineTypeFilter("all"); setMinEdge(""); setActionTagFilter("all"); setSharpOnly(false); setActivePreset(null); return; }
                      const cfg = getSaved() ?? p;
                      if (cfg.sport !== undefined) setSport(cfg.sport); else setSport("all");
                      if (cfg.lineType !== undefined) setLineTypeFilter(cfg.lineType); else setLineTypeFilter("all");
                      if (cfg.minEdge !== undefined) setMinEdge(cfg.minEdge); else setMinEdge("");
                      if (cfg.actionTag !== undefined) setActionTagFilter(cfg.actionTag); else setActionTagFilter("all");
                      if (cfg.sharpOnly !== undefined) setSharpOnly(cfg.sharpOnly); else setSharpOnly(false);
                      setActivePreset(p.label);
                    }}
                    className={`px-2 py-0.5 rounded font-mono text-[10px] border transition-colors ${isActive ? "bg-primary/20 text-primary border-primary/30" : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"}`}
                  >
                    {p.icon} {p.label}
                  </button>
                );
              })}
              {presetsUnlocked && activePreset === "My Style" && (
                <button
                  onClick={() => { try { const saved = JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>; saved["My Style"] = { sport, lineType: lineTypeFilter, minEdge, actionTag: actionTagFilter, sharpOnly }; localStorage.setItem(PRESET_LS_KEY, JSON.stringify(saved)); } catch {} }}
                  className="text-[10px] font-mono text-amber-400 hover:text-amber-300 px-1"
                >
                  💾 save
                </button>
              )}
              {presetsUnlocked && activePreset && (
                <button
                  onClick={() => { setSport("all"); setLineTypeFilter("all"); setMinEdge(""); setActionTagFilter("all"); setSharpOnly(false); setActivePreset(null); }}
                  className="text-[10px] font-mono text-slate-500 hover:text-rose-400 px-1"
                >
                  ✕ clear
                </button>
              )}
            </div>
            )}

            {/* Mobile search */}
            <div className="md:hidden">
              <Input
                placeholder="Search player…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="w-full bg-slate-900 border-slate-700 font-mono text-sm h-9"
              />
            </div>

            {/* Desktop: search + filters + actions — single wrapping row */}
            <div className="hidden md:flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Search player…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="flex-1 min-w-[200px] bg-slate-900 border-slate-700 font-mono text-sm h-9"
              />
              <Select value={sport} onValueChange={setSport}>
                <SelectTrigger className="w-28 bg-slate-900 border-slate-800 font-mono text-sm">
                  <SelectValue placeholder="Sport" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sports</SelectItem>
                  <SelectItem value="NBA">NBA</SelectItem>
                  <SelectItem value="NFL">NFL</SelectItem>
                  <SelectItem value="MLB">MLB</SelectItem>
                  <SelectItem value="NHL">NHL</SelectItem>
                  <SelectItem value="WNBA">WNBA</SelectItem>
                </SelectContent>
              </Select>
              <Select value={lineTypeFilter} onValueChange={v => { setLineTypeFilter(v); setActivePreset(null); }}>
                <SelectTrigger className="w-28 bg-slate-900 border-slate-800 font-mono text-sm">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="goblin">Goblin</SelectItem>
                  <SelectItem value="demon">Demon</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                </SelectContent>
              </Select>
              <Select value={actionTagFilter} onValueChange={v => { setActionTagFilter(v); setActivePreset(null); }}>
                <SelectTrigger className="w-24 bg-slate-900 border-slate-800 font-mono text-sm">
                  <SelectValue placeholder="Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tags</SelectItem>
                  <SelectItem value="PLAY">PLAY</SelectItem>
                  <SelectItem value="WATCH">WATCH</SelectItem>
                  <SelectItem value="PASS">PASS</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Min Edge"
                value={minEdge}
                onChange={e => setMinEdge(e.target.value)}
                className="w-24 bg-slate-900 border-slate-800 font-mono text-sm"
              />
              <Button
                onClick={runOptimizer}
                size="sm"
                className="font-mono text-xs bg-violet-700 hover:bg-violet-600 text-white gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" /> {optLoaded ? "Re-run" : "Optimizer"}
              </Button>
              <Button
                onClick={() => setSharpOnly(v => !v)}
                size="sm"
                variant={sharpOnly ? "default" : "outline"}
                className={sharpOnly
                  ? "font-mono text-xs gap-1.5 bg-amber-700 hover:bg-amber-600 text-white"
                  : "font-mono text-xs gap-1.5 border-slate-700 text-muted-foreground hover:text-amber-300"}
              >
                ⚡ {sharpOnly ? "Sharp Only" : "Sharp"}
              </Button>
              <SyncProjectionsButton />
              <ForceSyncButton />
              {(() => {
                const overridden = playerRows.filter(r => r.lineValueOverride != null || r.payoutMultiplier != null);
                if (overridden.length === 0) return null;
                return (
                  <button
                    onClick={() => {
                      for (const r of overridden) saveOverride(r.ppLineId, { lineValueOverride: null, payoutMultiplier: null });
                    }}
                    className="text-xs font-mono text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-700 rounded px-2 py-1 transition-colors"
                  >
                    Clear {overridden.length} override{overridden.length > 1 ? "s" : ""}
                  </button>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* Pre-lock window banner */}
      {preLockStatus?.preLockActive && (
        <div className="flex items-center gap-3 text-amber-300 bg-amber-950/20 border border-amber-500/30 rounded px-3 py-2 text-xs font-mono">
          <AlertCircle className="w-4 h-4 shrink-0 animate-pulse" />
          <span><span className="font-bold">Pre-Lock Window</span> — games start within 2 h. Lines are syncing every minute.</span>
        </div>
      )}

      {/* Stale odds banner (FS2) */}
      {oddsStale && (
        <div className="flex items-center justify-between gap-3 text-amber-300 bg-amber-950/20 border border-amber-500/30 rounded px-3 py-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Odds data is stale (last sync: {lastOddsSync ? new Date(lastOddsSync).toLocaleString() : "never"}). True Edge column hidden.
          </div>
          <SyncOddsButton />
        </div>
      )}

      {/* Not synced banner — only when there are also no seeded props to show */}
      {notSynced && !isLoading && playerRows.length === 0 && (
        <div className="flex items-center justify-between gap-3 text-amber-400 bg-amber-950/20 border border-amber-700/30 rounded px-3 py-2 text-sm font-mono">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            No live data — use <span className="font-bold mx-1">Force Sync</span> to pull props from PrizePicks.
          </div>
          <ForceSyncButton />
        </div>
      )}

      {/* Table */}
      {tab === "player" ? (
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col min-h-0">
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader className="bg-slate-950 sticky top-0 z-10">
                <TableRow className="border-slate-800 hover:bg-slate-950">
                  <TableHead className="w-8 font-mono text-xs" />
                  <TableHead className="w-14 font-mono text-xs">Sport</TableHead>
                  <SortTh col="playerName" label="Player" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh col="position" label="Pos" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden md:table-cell w-12 text-center" />
                  <TableHead className="hidden md:table-cell w-12 font-mono text-xs">Team</TableHead>
                  <TableHead className="hidden md:table-cell w-12 font-mono text-xs">Opp</TableHead>
                  <SortTh col="statType" label="Stat" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-28" />
                  <SortTh col="ppLine" label="PP Line" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-16 text-right" />
                  <TableHead className="w-20 font-mono text-xs text-center">Type</TableHead>
                  <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-right">Mkt Avg</TableHead>
                  {!oddsStale && (
                    <SortTh col="trueEdge" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-22 text-right">
                      <Tooltip>
                        <TooltipTrigger className="cursor-pointer">True Edge{sortCol === "trueEdge" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</TooltipTrigger>
                        <TooltipContent className="text-xs max-w-xs">
                          Our model P(over) vs consensus no-vig market probability. Vig stripped from external book lines.
                        </TooltipContent>
                      </Tooltip>
                    </SortTh>
                  )}
                  <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-right">Hold%</TableHead>
                  <SortTh col="projGap" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-28 text-right" label="Our Proj ⇕" />
                  <SortTh col="vor" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-16 text-right">
                    <Tooltip>
                      <TooltipTrigger className="cursor-pointer">VOR{sortCol === "vor" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</TooltipTrigger>
                      <TooltipContent className="text-xs max-w-xs">
                        Value Over Replacement — (model projection − line) / σ. Measures edge size relative to natural variance.
                      </TooltipContent>
                    </Tooltip>
                  </SortTh>
                  <SortTh col="pOver" label="P(Over)" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-20 text-center" />
                  <TableHead className="hidden md:table-cell w-14 font-mono text-xs text-center">Streak</TableHead>
                  <TableHead className="hidden lg:table-cell w-20 font-mono text-xs text-center">Pace</TableHead>
                  {isNflSlate && <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-center">Snap%</TableHead>}
                  {isNflSlate && <TableHead className="hidden lg:table-cell w-20 font-mono text-xs text-center">Tgt Shr</TableHead>}
                  {isNflSlate && <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-center">WOPR</TableHead>}
                  <TableHead className="w-24 font-mono text-xs text-center">Action</TableHead>
                  {varianceEnabled && <SortTh col="fatigue" label="Fatigue" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-22 text-center" />}
                  {varianceEnabled && <SortTh col="blowout" label="Blowout%" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-22 text-center" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-800">
                      {Array.from({ length: (varianceEnabled ? 20 : 18) - (oddsStale ? 1 : 0) }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-800" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : playerRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={(varianceEnabled ? 20 : 18) - (oddsStale ? 1 : 0)} className="h-48 text-center text-muted-foreground font-mono">
                      {sport !== "all" ? `No ${sport} props on the board — try All Sports` : "No props — click Force Sync to load live slate"}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => {
                    const isNoPlay = row.actionTag === "NO-PLAY";
                    const proj: OurProjection | null = row.ourProjection ?? null;
                    const displayPOver = getOverridePOver(row) ?? proj?.pOver ?? null;

                    const isExpanded = expandedRow === row.ppLineId;

                    return (
                      <React.Fragment key={row.ppLineId}>
                      <TableRow
                        className={`border-slate-800 cursor-pointer transition-colors ${
                          isNoPlay ? "opacity-50 hover:opacity-70" :
                          row.isWatched ? "bg-amber-950/10 hover:bg-amber-950/20" :
                          "hover:bg-slate-800/50"
                        }`}
                        onClick={() => setSelectedPropId(row.ppLineId)}
                      >
                        <TableCell onClick={e => e.stopPropagation()} className="pr-0">
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedRow(v => v === row.ppLineId ? null : row.ppLineId); }}
                              className="text-slate-700 hover:text-slate-300 transition-colors p-0.5 rounded shrink-0"
                            >
                              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </button>
                            <WatchToggle row={row} slateParams={slateParams} />
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-primary">{row.sport}</TableCell>
                        <TableCell className="font-bold">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar name={row.playerName} imageUrl={row.imageUrl} size="sm" />
                            <div>
                              <div className="font-bold text-sm leading-tight">{row.playerName}</div>
                              {proj?.dataQualityScore != null && !isNoPlay && (
                                <DQBadge score={proj.dataQualityScore} />
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell font-mono text-[10px] text-center text-slate-400">
                          {row.position ?? "—"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">{row.teamAbbr ?? "—"}</TableCell>
                        <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">{row.opponentAbbr ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{row.statType}</TableCell>
                        <TableCell className="font-mono text-sm font-bold text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            {editingLine === row.ppLineId ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="0.5"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      const v = parseFloat(editValue);
                                      if (!isNaN(v) && Math.abs(v) <= 10000) saveOverride(row.ppLineId, { lineValueOverride: v });
                                      setEditingLine(null);
                                    }
                                    if (e.key === "Escape") setEditingLine(null);
                                    if (e.key === "Delete") {
                                      saveOverride(row.ppLineId, { lineValueOverride: null });
                                      setEditingLine(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    const v = parseFloat(editValue);
                                    if (!isNaN(v) && Math.abs(v) <= 10000 && v !== (row.lineValueOverride ?? row.lineValue)) {
                                      saveOverride(row.ppLineId, { lineValueOverride: v });
                                    }
                                    setEditingLine(null);
                                  }}
                                  autoFocus
                                  className="w-16 bg-slate-800 border border-cyan-500 rounded px-1 py-0.5 text-cyan-400 text-xs font-mono text-right"
                                />
                              </div>
                            ) : (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setEditingLine(row.ppLineId);
                                  setEditValue((row.lineValueOverride ?? row.lineValue ?? 0).toString());
                                }}
                                className="text-cyan-400 hover:text-cyan-300 hover:underline transition-colors cursor-pointer"
                                title="Click to confirm PP line"
                              >
                                {getEffectiveLine(row)}
                                {hasOverride(row) && (
                                  <span className="text-[9px] text-emerald-400 ml-1">✓</span>
                                )}
                              </button>
                            )}
                            {(() => {
                              const overridePOver = getOverridePOver(row);
                              const lineVal = getEffectiveLine(row);
                              const projVal = row.ourProjection?.value ?? null;
                              if (!projVal || projVal === 0) return null;
                              const ratio = lineVal / projVal;
                              return (
                                <>
                                  {overridePOver !== null && (
                                    <span className="text-[9px] text-emerald-300 font-mono">{overridePOver}%↑</span>
                                  )}
                                  {ratio < 0.6 && <span className="text-xs text-emerald-400 font-mono ml-1">👹</span>}
                                  {ratio > 1.2 && <span className="text-xs text-rose-400 font-mono ml-1">😈</span>}
                                </>
                              );
                            })()}
                            {betterLineMap.has(row.ppLineId) && (() => {
                              const bl = betterLineMap.get(row.ppLineId)!;
                              const pLabel = bl.platform === "underdog" ? "UD" : bl.platform.charAt(0).toUpperCase() + bl.platform.slice(1);
                              return (
                                <span className="text-[9px] font-mono font-medium text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 rounded px-1 py-px leading-none whitespace-nowrap">
                                  ↓{bl.lineValue} {pLabel}
                                </span>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex flex-col items-center gap-0.5">
                            <LineTypeBadge type={row.lineType} />
                            {(row.lineType === "demon" || row.lineType === "goblin") && (() => {
                              // PrizePicks multipliers are dynamic (set at lineup-build time), so we
                              // do NOT fabricate a per-line payout. Instead show the BREAK-EVEN
                              // multiplier = 1 / hit-probability — the minimum payout that makes this
                              // rung +EV. Compare it to the live PrizePicks number. The editable field
                              // is an OPTIONAL record of the actual multiplier you saw.
                              const be = row.pOver != null && row.pOver > 0 ? 100 / row.pOver : null;
                              const manual = row.payoutMultiplier != null;
                              const editKey = -row.ppLineId; // negative = multiplier editor for this row
                              return (
                                <>
                                  {be != null && (
                                    <span
                                      className="text-[9px] font-mono text-violet-300 leading-none"
                                      title="Break-even multiplier = 1 / hit probability. The live PrizePicks payout must beat this for the pick to be +EV."
                                    >
                                      BE ×{be.toFixed(2)}
                                    </span>
                                  )}
                                  {editingLine === editKey ? (
                                    <input
                                      type="number"
                                      step="0.05"
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") {
                                          const v = parseFloat(editValue);
                                          if (!isNaN(v) && v > 0) saveOverride(row.ppLineId, { payoutMultiplier: v });
                                          setEditingLine(null);
                                        }
                                        if (e.key === "Escape") setEditingLine(null);
                                        if (e.key === "Delete") { saveOverride(row.ppLineId, { payoutMultiplier: null }); setEditingLine(null); }
                                      }}
                                      onBlur={() => {
                                        const v = parseFloat(editValue);
                                        if (!isNaN(v) && v > 0 && v !== row.payoutMultiplier) saveOverride(row.ppLineId, { payoutMultiplier: v });
                                        setEditingLine(null);
                                      }}
                                      autoFocus
                                      className="w-12 bg-slate-800 border border-amber-500 rounded px-1 py-0.5 text-amber-300 text-[10px] font-mono text-center"
                                    />
                                  ) : (
                                    <button
                                      onClick={e => { e.stopPropagation(); setEditingLine(editKey); setEditValue((row.payoutMultiplier ?? "").toString()); }}
                                      className={`text-[9px] font-mono rounded px-1 leading-none transition-colors ${manual ? "text-amber-300 hover:text-amber-200" : "text-slate-600 hover:text-slate-400"}`}
                                      title={manual ? "Actual PrizePicks multiplier you recorded — click to edit, Delete to clear" : "Record the actual PrizePicks multiplier (optional)"}
                                    >
                                      {manual ? `×${row.payoutMultiplier!.toFixed(2)}✓` : "+mult"}
                                    </button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </TableCell>

                        {/* Market avg */}
                        <TableCell className="hidden lg:table-cell font-mono text-xs text-right">
                          {row.marketDataStatus === "not_synced" ? (
                            <span className="text-slate-600">—</span>
                          ) : row.marketAvg != null ? (
                            <span className="text-slate-300">{row.marketAvg.toFixed(1)}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TableCell>

                        {/* True edge — hidden when odds are stale (FS2) */}
                        {!oddsStale && (
                          <TableCell className="hidden lg:table-cell font-mono text-xs text-right">
                            {row.marketDataStatus === "not_synced" ? (
                              <span className="text-slate-600 text-[10px]">no data</span>
                            ) : row.trueEdge != null ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <span className={`font-bold flex items-center justify-end gap-0.5 ${row.trueEdge > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                  <MarketStatusDot status={row.marketDataStatus} />
                                  {row.trueEdge > 0 ? "+" : ""}{row.trueEdge.toFixed(1)}%
                                </span>
                                {row.calibrationCount != null && row.calibrationCount < 30 && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-[9px] font-mono text-amber-400 bg-amber-950/30 border border-amber-800/30 rounded px-1 cursor-help leading-tight">LOW SAMPLE</span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="font-mono text-xs max-w-xs">
                                      Edge score based on limited calibration data ({row.calibrationCount} results). Treat with caution until 30+ logged.
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-600 text-[10px]">no data</span>
                            )}
                          </TableCell>
                        )}

                        {/* Hold% */}
                        <TableCell className="hidden lg:table-cell font-mono text-xs text-right">
                          {row.marketHoldPct != null ? (
                            <span className={
                              row.holdRating === "low"      ? "text-emerald-400" :
                              row.holdRating === "moderate" ? "text-amber-400"   :
                              row.holdRating === "high"     ? "text-rose-400"    :
                              "text-muted-foreground"
                            }>
                              {row.marketHoldPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </TableCell>

                        {/* Our projection */}
                        <TableCell className="hidden lg:table-cell text-right">
                          <ProjectionCell proj={proj} ppLine={getEffectiveLine(row)} />
                        </TableCell>

                        {/* VOR — Value Over Replacement */}
                        <TableCell className="hidden lg:table-cell font-mono text-xs text-right">
                          {proj?.vor != null ? (
                            <span className={
                              proj.vor > 0.5  ? "text-emerald-400 font-bold" :
                              proj.vor > 0.1  ? "text-emerald-300" :
                              proj.vor > -0.1 ? "text-slate-500" :
                              "text-rose-400"
                            }>
                              {proj.vor > 0 ? "+" : ""}{proj.vor.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TableCell>

                        {/* P(over) — Fix 5: suppress badge for prior-only / insufficient data props */}
                        <TableCell className="text-center">
                          {proj?.sourceLabel === "prior_only" || !proj?.gamesUsed || proj.gamesUsed < 5 ? (
                            <span
                              className="text-slate-600 font-mono text-xs"
                              title="Insufficient game log data — projection based on prior only"
                            >
                              —
                            </span>
                          ) : (
                            <POverBadge
                              pOver={displayPOver}
                              noPlayReason={proj?.noPlayReason}
                            />
                          )}
                        </TableCell>

                        {/* Streak */}
                        <TableCell className="hidden md:table-cell text-center font-mono text-xs">
                          {row.streak && row.streak.count >= 2 ? (
                            <span className={row.streak.type === "over" ? "text-emerald-400" : "text-rose-400"}>
                              {row.streak.count}{row.streak.type === "over" ? "↑" : "↓"}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TableCell>

                        {/* Pace */}
                        <TableCell className="hidden lg:table-cell text-center">
                          {(() => {
                            const pace = row.teamId != null ? paceMap.get(row.teamId) : undefined;
                            if (!pace) return <span className="text-slate-600 font-mono text-xs">—</span>;
                            const colorClass = pace.paceColor === "fast"
                              ? "text-emerald-400"
                              : pace.paceColor === "slow"
                              ? "text-rose-400"
                              : "text-amber-400";
                            const adj = pace.paceAdjustment;
                            const adjStr = adj > 0 ? `+${(adj * 100).toFixed(0)}%` : adj < 0 ? `${(adj * 100).toFixed(0)}%` : "±0%";
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex flex-col items-center gap-0.5 cursor-help">
                                    <span className={`text-xs font-mono font-bold ${colorClass}`}>{pace.estimatedGamePace.toFixed(1)}</span>
                                    <span className={`text-[9px] font-mono ${colorClass}`}>{adjStr}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="font-mono text-xs max-w-[200px]">
                                  <p className="font-bold mb-0.5">{pace.paceLabel}</p>
                                  <p className="text-slate-400">Est. game pace: {pace.estimatedGamePace.toFixed(1)} poss/48</p>
                                  <p className="text-slate-400">Projection adj: {adjStr}</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()}
                        </TableCell>

                        {/* NFL Advanced Metrics */}
                        {isNflSlate && (() => {
                          const adv = nflAdvMap.get(row.playerName.toLowerCase());
                          const snapPct   = adv?.snapPct   ?? null;
                          const tgtShare  = adv?.targetShare ?? null;
                          const wopr      = adv?.wopr       ?? null;
                          const isWrTeRb  = ["WR","TE","RB"].includes(adv?.position ?? row.position ?? "");

                          const snapColor = snapPct == null ? "text-slate-600"
                            : snapPct >= 0.75 ? "text-emerald-400"
                            : snapPct >= 0.50 ? "text-amber-400"
                            : "text-rose-400";

                          const tgtColor = tgtShare == null ? "text-slate-600"
                            : tgtShare >= 0.20 ? "text-emerald-400"
                            : tgtShare >= 0.10 ? "text-amber-400"
                            : "text-rose-400";

                          return (
                            <>
                              <TableCell className="hidden lg:table-cell text-center font-mono text-xs">
                                {snapPct != null ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`cursor-help font-bold ${snapColor}`}>
                                        {(snapPct * 100).toFixed(0)}%
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="font-mono text-xs">
                                      <p className="font-bold mb-0.5">Snap Count %</p>
                                      <p className="text-slate-400">
                                        {snapPct >= 0.75 ? "High snap share — full usage" : snapPct >= 0.50 ? "Moderate snap share" : "Low snap share — caution"}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : <span className="text-slate-600">—</span>}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-center font-mono text-xs">
                                {isWrTeRb && tgtShare != null ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`cursor-help font-bold ${tgtColor}`}>
                                        {(tgtShare * 100).toFixed(0)}%
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="font-mono text-xs">
                                      <p className="font-bold mb-0.5">Target Share</p>
                                      <p className="text-slate-400">
                                        {tgtShare >= 0.20 ? "High target share — featured receiver" : tgtShare >= 0.10 ? "Moderate involvement" : "Low target share"}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : <span className="text-slate-600">—</span>}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-center font-mono text-xs">
                                {isWrTeRb && wopr != null ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-help font-bold text-cyan-400">
                                        {wopr.toFixed(2)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="font-mono text-xs">
                                      <p className="font-bold mb-0.5">WOPR — Weighted Opportunity Rating</p>
                                      <p className="text-slate-400">Combined target share + air yards share. Higher = more passing game involvement.</p>
                                      <p className="text-slate-400 mt-0.5">{wopr >= 0.50 ? "Elite involvement" : wopr >= 0.30 ? "Solid involvement" : "Limited role"}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : <span className="text-slate-600">—</span>}
                              </TableCell>
                            </>
                          );
                        })()}

                        {/* Action */}
                        <TableCell className="text-center">
                          {isNoPlay && proj?.noPlayReason ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div><ActionTagBadge tag="NO-PLAY" /></div>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                <p className="font-bold text-rose-400 mb-0.5">Gated: {proj.noPlayReason.replace(/_/g, " ")}</p>
                                {proj.dataQualityScore != null && (
                                  <p className="text-slate-400">DQ score: {proj.dataQualityScore}/100</p>
                                )}
                                {proj.sourceLabel && (
                                  <p className="text-slate-400">Source: {proj.sourceLabel}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <div className="flex items-center gap-1 justify-center">
                              {(() => {
                                const overridePOver = getOverridePOver(row);
                                if (overridePOver !== null) {
                                  if (overridePOver >= 62) {
                                    return (
                                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-emerald-900/50 border border-emerald-600/50 text-emerald-300">
                                        ▲ MORE
                                      </span>
                                    );
                                  } else if (overridePOver <= 38) {
                                    return (
                                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-rose-900/50 border border-rose-600/50 text-rose-300">
                                        ▼ LESS
                                      </span>
                                    );
                                  } else {
                                    return (
                                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800/50 border border-slate-600/50 text-slate-400">
                                        — PASS
                                      </span>
                                    );
                                  }
                                }
                                return <ActionTagBadge tag={row.actionTag} />;
                              })()}
                              {row.sharpSignal === "sharp" && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-amber-400 text-[11px] cursor-help leading-none">⚡</span>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                    <p className="font-bold text-amber-400 mb-1">Sharp Signal — {row.sharpConfidence} confidence</p>
                                    <p className="text-slate-300 leading-relaxed">{row.sharpExplanation}</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* Variance Volatility Badge */}
                        {varianceEnabled && (
                          <TableCell className="hidden lg:table-cell text-center">
                            {row.variance?.volatilityRating ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex justify-center cursor-help">
                                    <VarianceBadge rating={row.variance.volatilityRating} size="xs" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                  {row.variance.whyItMoves && <p className="mb-1">{row.variance.whyItMoves}</p>}
                                  {row.variance.fatigueScore != null && <p className="text-slate-400">Fatigue: {row.variance.fatigueScore}/100</p>}
                                  {row.variance.blowoutRisk != null && <p className="text-slate-400">Blowout risk: {row.variance.blowoutRisk}%</p>}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="border-slate-800 bg-slate-950/80">
                          <TableCell colSpan={100} className="p-4">
                            {proj?.gamesUsed != null && proj.gamesUsed < 5 ? (
                              <div className="flex items-center gap-2 text-xs font-mono text-amber-400/70 bg-amber-950/10 border border-amber-800/20 rounded px-3 py-2">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                Charts unlock after 5+ games logged — only {proj.gamesUsed} game{proj.gamesUsed !== 1 ? "s" : ""} recorded for this prop
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <MiniGameChart values={row.gameLogs ?? []} ppLine={getEffectiveLine(row)} />
                                <HitRateChart values={row.gameLogs ?? []} ppLine={getEffectiveLine(row)} />
                                {proj?.stdDev != null ? (
                                  <DistributionChart mean={proj.value} stdDev={proj.stdDev} ppLine={getEffectiveLine(row)} />
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-mono text-slate-500 uppercase">Distribution</span>
                                    <span className="text-xs font-mono text-slate-600">No std dev available</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {visibleCount < playerRows.length && (
              <div className="flex justify-center py-3 border-t border-slate-800">
                <Button
                  size="sm" variant="outline"
                  onClick={() => setVisibleCount(c => c + 75)}
                  className="font-mono text-xs border-slate-700 text-slate-400 hover:text-foreground gap-1.5"
                >
                  Show more ({playerRows.length - visibleCount} remaining)
                </Button>
              </div>
            )}
            {visibleCount >= playerRows.length && miHasMore && (
              <div className="flex items-center justify-center gap-4 py-3 border-t border-slate-800">
                <span className="text-xs font-mono text-slate-500">
                  Showing {allMiRows.length} of {miTotal} props
                </span>
                <Button
                  size="sm" variant="outline"
                  onClick={() => setMiPage(p => p + 1)}
                  disabled={miLoading}
                  className="font-mono text-xs border-slate-700 text-slate-400 hover:text-foreground gap-1.5"
                >
                  {miLoading ? <><RefreshCw className="w-3 h-3 animate-spin" /> Loading…</> : <>Load More ({miTotal - allMiRows.length} remaining)</>}
                </Button>
              </div>
            )}
            {!miHasMore && allMiRows.length > 0 && (
              <div className="flex justify-center py-2 border-t border-slate-800">
                <span className="text-xs font-mono text-slate-600">All {miTotal} props loaded</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <TeamPicksBoard rows={teamRows} isLoading={isLoading} onSelectProp={setSelectedPropId} />
      )}

      {/* Mobile filter drawer */}
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="bottom" className="h-auto pb-8 bg-slate-900 border-slate-700">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">Filters</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1.5 block uppercase">Sport</label>
              <Select value={sport} onValueChange={setSport}>
                <SelectTrigger className="w-full bg-slate-950 border-slate-700 font-mono text-sm">
                  <SelectValue placeholder="Sport" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sports</SelectItem>
                  <SelectItem value="NBA">NBA</SelectItem>
                  <SelectItem value="NFL">NFL</SelectItem>
                  <SelectItem value="MLB">MLB</SelectItem>
                  <SelectItem value="NHL">NHL</SelectItem>
                  <SelectItem value="WNBA">WNBA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1.5 block uppercase">Line Type</label>
              <Select value={lineTypeFilter} onValueChange={setLineTypeFilter}>
                <SelectTrigger className="w-full bg-slate-950 border-slate-700 font-mono text-sm">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="goblin">Goblin</SelectItem>
                  <SelectItem value="demon">Demon</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1.5 block uppercase">Min Edge</label>
              <Input
                placeholder="e.g. 5"
                value={minEdge}
                onChange={e => setMinEdge(e.target.value)}
                className="bg-slate-950 border-slate-700 font-mono text-sm"
              />
            </div>
            <Button size="sm" onClick={() => setFilterOpen(false)} className="w-full font-mono text-xs">
              Apply Filters
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {(() => {
        const sharpRow = selectedPropId ? miMap.get(selectedPropId) : undefined;
        return (
          <PropDetailSheet
            ppLineId={selectedPropId}
            open={!!selectedPropId}
            onOpenChange={open => !open && setSelectedPropId(null)}
            sharpSignal={sharpRow?.sharpSignal ?? null}
            sharpConfidence={sharpRow?.sharpConfidence ?? null}
            sharpExplanation={sharpRow?.sharpExplanation ?? null}
            sharpSide={sharpRow?.sharpSide ?? null}
            sharpPublicPct={sharpRow?.sharpPublicPct ?? null}
            calibrationCount={sharpRow?.calibrationCount ?? null}
          />
        );
      })()}

      {/* Optimizer Dialog */}
      <Dialog open={optimizerOpen} onOpenChange={setOptimizerOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm uppercase tracking-wider">
              <Zap className="w-4 h-4 text-violet-400" />
              Optimizer — Goblin Hunter
            </DialogTitle>
            <DialogDescription className="text-xs font-mono text-muted-foreground">
              Strategy: Goblin OVER only · Power Play · Top {optPickCount} picks by P(Over)
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-mono text-muted-foreground">Pick count:</span>
            {[2, 3, 4, 5, 6].map(n => (
              <button
                key={n}
                onClick={() => { setOptPickCount(n); setOptLoaded(false); }}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  optPickCount === n
                    ? "bg-violet-700 text-white"
                    : "bg-slate-800 text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
            <Button
              size="sm"
              onClick={runOptimizer}
              className="ml-auto font-mono text-xs bg-violet-700 hover:bg-violet-600 gap-1"
            >
              <Zap className="w-3 h-3" /> {optLoaded ? "Re-run" : "Run"}
            </Button>
          </div>
          {optLoaded && (() => {
            try {
              const ts = Number(localStorage.getItem("pp_opt_ts") ?? 0);
              const ageMin = Math.floor((Date.now() - ts) / 60000);
              if (ageMin > 60) return (
                <div className="text-[10px] font-mono text-amber-400 bg-amber-950/20 border border-amber-700/30 rounded px-2 py-1 mb-2">
                  ⚠ Results from {ageMin}m ago — consider re-running for fresh data
                </div>
              );
            } catch {}
            return null;
          })()}

          {optLoaded && (
            optResults.length === 0 ? (
              <div className="py-6 text-center text-xs font-mono text-muted-foreground">
                No Goblin OVER picks available. Try syncing props first.
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  {optResults.map((r, i) => {
                    const multiplier = POWER_MULTIPLIERS[optResults.length] ?? 10;
                    const pChain = optResults.slice(0, i + 1).reduce((acc, x) => acc * (x.pOver / 100), 1);
                    return (
                      <div key={r.ppLineId} className="flex items-center gap-2 bg-slate-800/60 rounded px-3 py-2">
                        <span className="w-5 text-xs font-mono text-slate-500">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-foreground truncate">{r.playerName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{r.statType} OVER {r.lineValue}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs font-mono font-bold text-emerald-400">{r.pOver.toFixed(1)}%</div>
                          <div className="text-[10px] text-muted-foreground font-mono">P(Over)</div>
                        </div>
                        <div className="text-center ml-2">
                          <div className={`text-xs font-mono font-bold ${r.ev > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {r.ev >= 0 ? "+" : ""}${r.ev.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">EV@$25</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Combined chain */}
                <div className="bg-slate-800/40 rounded px-3 py-2 text-xs font-mono text-center">
                  <span className="text-muted-foreground">
                    {optResults.map(r => `${r.pOver.toFixed(0)}%`).join(" × ")}
                  </span>
                  {" = "}
                  <span className="text-foreground font-bold">
                    {(optResults.reduce((acc, r) => acc * (r.pOver / 100), 1) * 100).toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground ml-3">
                    · EV {(() => {
                      const mult = POWER_MULTIPLIERS[optResults.length] ?? 10;
                      const p = optResults.reduce((acc, r) => acc * (r.pOver / 100), 1);
                      const ev = p * mult * 25 - 25;
                      return `${ev >= 0 ? "+" : ""}$${ev.toFixed(2)}`;
                    })()}
                  </span>
                </div>

                <Button
                  onClick={loadOptimizerToEntry}
                  className="w-full font-mono text-xs bg-primary hover:bg-primary/90 gap-2"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  Load {optResults.length} picks into Entry Builder
                </Button>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
