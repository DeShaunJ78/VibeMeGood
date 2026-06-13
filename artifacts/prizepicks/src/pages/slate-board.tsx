import React, { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  useGetSlate, getGetSlateQueryKey, useGetSlateSports,
  useAddToWatchlist, useRemoveFromWatchlist, useSetPpLineOverrides,
  useGetDataHealth,
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
import { LineTypeBadge, ActionTagBadge, POverBadge, DQBadge, BestValueBadge } from "@/components/ui/badges";
import { PropDetailSheet } from "@/components/prop-detail-sheet";
import { TeamPicksBoard } from "@/components/team-picks-board";
import { CulturePicksBoard } from "@/components/culture-picks-board";
import { Users, User, Eye, EyeOff, RefreshCw, AlertCircle, AlertTriangle, TrendingUp, TrendingDown, Minus, Zap, ArrowRight, Filter, ChevronDown, ChevronRight, X, Clock, Sparkles, Pin } from "lucide-react";
import { addPinnedPick, removePinnedPick, readPinnedPicks } from "@/lib/pinned-picks";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell, ResponsiveContainer, AreaChart, Area } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useEntry, type EntryPick } from "@/lib/entry-context";
import { VarianceBadge } from "@/components/ui/variance-badge";
import { useUserSettings } from "@/hooks/use-user-settings";
import { PlayerAvatar } from "@/components/ui/player-avatar";

type ProjectionFactor = { key: string; label: string; factor: number; explain: string };

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
  ensembleBlendPct: number;
  calSampleSize: number;
  adjustments: ProjectionFactor[];
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
  sharpSignal:      "sharp" | "fade" | "neutral" | null;
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

function PinToOptimizerButton({
  row, pinnedIds, onToggle,
}: { row: any; pinnedIds: Set<number>; onToggle: (fn: (prev: Set<number>) => Set<number>) => void }) {
  const { toast } = useToast();
  const isPinned = pinnedIds.has(row.ppLineId);

  function handlePin(e: React.MouseEvent) {
    e.stopPropagation();
    if (isPinned) {
      removePinnedPick(row.ppLineId);
      onToggle(prev => { const next = new Set(prev); next.delete(row.ppLineId); return next; });
      toast({ title: "Unpinned from Lineup Factory", description: row.playerName });
    } else {
      const added = addPinnedPick({
        ppLineId: row.ppLineId,
        playerId: row.playerId,
        playerName: row.playerName,
        statType: row.statType,
        sport: row.sport,
        lineValue: row.lineValue,
      });
      if (added) {
        onToggle(prev => new Set([...prev, row.ppLineId]));
        toast({ title: "Pinned to Lineup Factory", description: `${row.playerName} · ${row.statType}` });
      }
    }
  }

  return (
    <button
      onClick={handlePin}
      title={isPinned ? "Unpin from Lineup Factory" : "Pin to Lineup Factory"}
      className={`h-6 w-6 rounded shrink-0 flex items-center justify-center transition-colors ${
        isPinned ? "text-primary hover:text-primary/70" : "text-slate-700 hover:text-primary/60"
      }`}
    >
      <Pin className={`w-3 h-3 ${isPinned ? "fill-primary" : ""}`} />
    </button>
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
  opponentAbbr: string | null;
  gameId: number | null;
  statType: string;
  lineValue: number;
  lineType: string;
  pOver: number;
  ev: number;
  edgeScore: number | null;
  actionTag: string | null;
  ourProjection: OurProjection | null;
}

/** Normalized game-match key: prefers gameId (stable integer); falls back to
 *  a sorted teamAbbr|opponentAbbr pair so rows without a gameId can still
 *  be correlated by matchup. Returns null when neither is available. */
function makeGameMatchKey(r: { gameId?: number | null; teamAbbr?: string | null; opponentAbbr?: string | null }): string | null {
  if (r.gameId != null) return `gid:${r.gameId}`;
  if (r.teamAbbr && r.opponentAbbr) {
    const a = r.teamAbbr.toUpperCase();
    const b = r.opponentAbbr.toUpperCase();
    return a < b ? `tm:${a}|${b}` : `tm:${b}|${a}`;
  }
  return null;
}

/** Returns game-correlated warnings for a set of optimizer results, grouped by gameId.
 *  Each entry describes one game that has 2+ picks in the lineup. */
function getGameCorrelations(
  results: OptResult[],
): { gameId: number; teamAbbr: string | null; opponentAbbr: string | null; players: string[]; count: number }[] {
  const byGame = new Map<number, { teamAbbr: string | null; opponentAbbr: string | null; players: string[] }>();
  for (const r of results) {
    if (r.gameId == null) continue;
    if (!byGame.has(r.gameId)) {
      byGame.set(r.gameId, { teamAbbr: r.teamAbbr, opponentAbbr: r.opponentAbbr, players: [] });
    }
    byGame.get(r.gameId)!.players.push(r.playerName);
  }
  return [...byGame.entries()]
    .filter(([, { players }]) => players.length >= 2)
    .map(([gameId, { teamAbbr, opponentAbbr, players }]) => ({
      gameId, teamAbbr, opponentAbbr, players, count: players.length,
    }));
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

function formatWindowTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrowStr = new Date(now.getTime() + 86_400_000).toDateString();
  const dayStr = d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (dayStr === todayStr) return time;
  if (dayStr === tomorrowStr) return `Tmrw ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

function normalCDF(mean: number, std: number, line: number): number {
  if (std <= 0) return line < mean ? 1 : 0;
  const z = (line - mean) / (std * Math.sqrt(2));
  return (1 - erf(z)) / 2;
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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
  const [tab, setTab] = useState<"player" | "team" | "culture">(() => {
    try {
      const t = localStorage.getItem("slate-tab");
      return (t === "team" || t === "culture") ? t : "player";
    } catch { return "player"; }
  });
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
  const [actionTagFilter, setActionTagFilter] = useState<string>(() => {
    try { return localStorage.getItem("slate-action-tag") ?? "all"; } catch { return "all"; }
  });
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(() => {
    try { return localStorage.getItem("vmg_active_preset"); } catch { return null; }
  });
  const [presetRevision, setPresetRevision] = useState(0);

  const activeFilterCount = [sport !== "all" && sport, lineTypeFilter !== "all" && lineTypeFilter, minEdge, actionTagFilter !== "all" && actionTagFilter].filter(Boolean).length;
  const [optPickCount, setOptPickCount] = useState<number>(() => {
    try { return Number(localStorage.getItem("opt-pick-count")) || 4; } catch { return 4; }
  });
  const [maxPerTeam, setMaxPerTeam] = useState<number>(() => {
    try { return Number(localStorage.getItem("opt-max-per-team")) || 2; } catch { return 2; }
  });
  const [maxPerGame, setMaxPerGame] = useState<number>(() => {
    try { return Number(localStorage.getItem("opt-max-per-game")) || 2; } catch { return 2; }
  });
  const [optSport, setOptSport] = useState<string>(() => {
    try { return localStorage.getItem("opt-sport") ?? "all"; } catch { return "all"; }
  });
  const [optMinEdge, setOptMinEdge] = useState<string>(() => {
    try { return localStorage.getItem("opt-min-edge") ?? ""; } catch { return ""; }
  });
  const [diversityNote, setDiversityNote] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sharpOnly, setSharpOnly] = useState(false);
  // "upcoming" = exclude finished games (default), "all" = everything,
  // or an ISO startTime string = show only that game window.
  const [selectedWindow, setSelectedWindow] = useState<string>("upcoming");
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

  const { data: dataHealth } = useGetDataHealth();
  const boardFreshnessAt = dataHealth?.boardFreshnessAt ?? null;
  const boardAgeHours    = dataHealth?.boardAgeHours    ?? null;
  const ppNeverSynced    = !boardFreshnessAt;
  const ppStale          = !ppNeverSynced && boardAgeHours != null && boardAgeHours > 2;

  const { data: preLockStatus } = useQuery<{ preLockActive: boolean }>({
    queryKey: ["pre-lock-status"],
    queryFn: async () => {
      const b = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const r = await fetch(`${b}/api/system-health/pre-lock`);
      return r.json() as Promise<{ preLockActive: boolean }>;
    },
    refetchInterval: 60_000,
  });

  const { data: readiness } = useQuery<{
    playersWithLogs: number; gameLogCount: number; calibrationBuckets: number;
    isDataReady: boolean; isCalibrationReady: boolean;
  }>({
    queryKey: ["data-readiness"],
    queryFn: async () => {
      const b = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      return fetch(`${b}/api/data-readiness`).then(r => r.json());
    },
    staleTime: 5 * 60_000,
  });

  // Bias data — shares the same query key as PropDetailSheet so the cache is
  // reused with no extra network request when both are mounted.
  const { data: biasData } = useQuery<{
    buckets: Array<{
      sport: string | null; statType: string; tier: string;
      delta: number | null; hasEnoughData: boolean;
    }>;
  }>({
    queryKey: ["stat-bias"],
    queryFn: async () => {
      const b = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const r = await fetch(`${b}/api/dashboard/stat-bias`);
      if (!r.ok) throw new Error("stat-bias fetch failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  // Map "sport|statType|tier" → delta for O(1) per-row lookup
  const biasDeltaMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of biasData?.buckets ?? []) {
      if (b.hasEnoughData && b.delta != null) {
        m.set(`${b.sport ?? ""}|${b.statType}|${b.tier}`, b.delta);
      }
    }
    return m;
  }, [biasData]);

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
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(
    () => new Set(readPinnedPicks().map(p => p.ppLineId)),
  );

  const slateParams = {
    sport: sport !== "all" ? sport : undefined,
  };

  const saveOverride = useCallback(
    (ppLineId: number, patch: { lineValueOverride?: number | null; payoutMultiplier?: number | null }) => {
      setOverride.mutate(
        { id: ppLineId, data: patch },
        { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetSlateQueryKey(slateParams) }); } },
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

  // Persist filter choices across sessions.
  useEffect(() => {
    if (sport !== "") { try { localStorage.setItem("slate-sport", sport); } catch {} }
  }, [sport]);
  useEffect(() => {
    try { localStorage.setItem("slate-tab", tab); } catch {}
  }, [tab]);
  useEffect(() => {
    try { localStorage.setItem("slate-action-tag", actionTagFilter); } catch {}
  }, [actionTagFilter]);
  useEffect(() => {
    try {
      if (activePreset) localStorage.setItem("vmg_active_preset", activePreset);
      else localStorage.removeItem("vmg_active_preset");
    } catch {}
  }, [activePreset]);

  // Keep pinnedIds in sync with any external changes (e.g. cleared from Lineup Factory)
  useEffect(() => {
    function syncPinned() {
      setPinnedIds(new Set(readPinnedPicks().map(p => p.ppLineId)));
    }
    window.addEventListener("pinned-picks-changed", syncPinned);
    return () => window.removeEventListener("pinned-picks-changed", syncPinned);
  }, []);

  // When the sport changes the available windows change too — reset to "upcoming"
  // so the view is never empty (wrong window selected for new sport).
  // Also reset the chip filter whenever sport is cleared back to "all" so stale
  // chip filters never silently narrow an all-sports view.
  // Exception: preset activations intentionally set sport="all" + an actionTag at
  // the same time (e.g. Safe → PLAY). We guard using a ref set synchronously in
  // the preset onClick before any state updates, so the effect always sees the
  // correct intent regardless of React batching order.
  const prevSport = useRef(sport);
  const isPresetChangeRef = useRef(false);
  useEffect(() => {
    if (prevSport.current !== sport && sport !== "") {
      if (sport === "all" && !isPresetChangeRef.current) setActionTagFilter("all");
      isPresetChangeRef.current = false;
      prevSport.current = sport;
      setSelectedWindow("upcoming");
    }
  }, [sport]);

  const { data: slate, isLoading: slateLoading } = useGetSlate(slateParams, {
    query: { queryKey: getGetSlateQueryKey(slateParams), enabled: sportResolved },
  });

  const allSportSlateParams = {};
  const { data: allSportSlate } = useGetSlate(allSportSlateParams, {
    query: {
      queryKey: getGetSlateQueryKey(allSportSlateParams),
      enabled: sportResolved && sport !== "all" && (tab === "team" || tab === "player" || tab === "culture"),
      staleTime: 5 * 60 * 1000,
    },
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
      sharpSignal:      (mi?.sharpSignal      ?? null) as "sharp" | "fade" | "neutral" | null,
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
      sharpSignal:      (mi.sharpSignal      ?? null) as "sharp" | "fade" | "neutral" | null,
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
  const totalTeamRowCount: number | null = sport !== "all" && allSportSlate
    ? (allSportSlate as any[]).filter((r: any) => r.pickCategory === "team").length
    : null;
  const cultureRows = allRows.filter((r) => r.pickCategory === "culture");
  const totalCultureRowCount: number | null = sport !== "all" && allSportSlate
    ? (allSportSlate as any[]).filter((r: any) => r.pickCategory === "culture").length
    : null;
  const totalPlayerRowCount: number | null = sport !== "all" && allSportSlate
    ? (allSportSlate as any[]).filter((r: any) => r.pickCategory !== "team" && r.pickCategory !== "culture").length
    : null;
  const notSynced = allMiRows.length === 0 && !miLoading && sport === "all";

  // Distinct game-time windows derived from the loaded slate. Each unique
  // startTime becomes one picker pill. Ordered chronologically so the user
  // sees morning → afternoon → evening left to right.
  const windowGroups = useMemo(() => {
    const map = new Map<string, { count: number; gameStatus: string | null; startTime: string }>();
    for (const r of (slate ?? []) as any[]) {
      const key: string = r.startTime ?? "__none__";
      const gs: string | null = r.gameStatus ?? null;
      const entry = map.get(key);
      if (entry) { entry.count++; }
      else { map.set(key, { count: 1, gameStatus: gs, startTime: key === "__none__" ? "" : key }); }
    }
    return [...map.entries()]
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => {
        if (a.key === "__none__") return 1;
        if (b.key === "__none__") return -1;
        return a.startTime.localeCompare(b.startTime);
      });
  }, [slate]);

  const playerRows = useMemo(() => {
    let rows = allRows.filter((r) => r.pickCategory !== "team" && r.pickCategory !== "culture");
    // Slate window — default hides completed games, specific windows isolate one time slot.
    if (selectedWindow === "upcoming") {
      rows = rows.filter(r => r.gameStatus !== "final");
    } else if (selectedWindow !== "all") {
      rows = rows.filter(r => (r.startTime ?? "__none__") === selectedWindow);
    }
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
  }, [allRows, lineTypeFilter, minEdge, searchQuery, sortCol, sortDir, sharpOnly, selectedWindow]);

  const watchCount  = useMemo(() => playerRows.filter(r => r.isWatched).length,   [playerRows]);
  const noPlayCount = useMemo(() => playerRows.filter(r => r.actionTag === "NO-PLAY").length, [playerRows]);
  const playCount   = useMemo(() => playerRows.filter(r => r.actionTag === "PLAY").length,    [playerRows]);
  const visibleRows = useMemo(() => playerRows.slice(0, visibleCount), [playerRows, visibleCount]);

  // Sport-filtered but action-tag-unfiltered player row count. Derived from
  // `mergedRows` (which is always sport-filtered and never action-tag-filtered,
  // since `slate` has no action-tag param) so it stays accurate whenever sport
  // or other non-action filters change — even while an action-tag filter is on.
  // Used on mobile as the Y denominator in "X / Y rows" when filtering by tag.
  const actionTagUnfilteredPlayerCount = useMemo(() => {
    let rows = mergedRows.filter((r: any) => r.pickCategory !== "team" && r.pickCategory !== "culture");
    if (selectedWindow === "upcoming") {
      rows = rows.filter((r: any) => r.gameStatus !== "final");
    } else if (selectedWindow !== "all") {
      rows = rows.filter((r: any) => (r.startTime ?? "__none__") === selectedWindow);
    }
    if (lineTypeFilter !== "all") {
      rows = rows.filter((r: any) => r.lineType === lineTypeFilter);
    } else {
      const seen = new Set<string>();
      rows = rows.filter((r: any) => {
        const key = `${r.playerId}:${r.statType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (minEdge) rows = rows.filter((r: any) => r.edgeScore != null && r.edgeScore >= parseFloat(minEdge));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((r: any) =>
        r.playerName.toLowerCase().includes(q) ||
        (r.teamAbbr ?? "").toLowerCase().includes(q)
      );
    }
    if (sharpOnly) rows = rows.filter((r: any) => r.sharpSignal === "sharp");
    return rows.length;
  }, [mergedRows, lineTypeFilter, minEdge, searchQuery, sharpOnly, selectedWindow]);

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

  // Build a correlation map from the UNFILTERED player rows (allRows minus team/culture)
  // so that watched/pinned picks hidden by view filters (search, edge, window, dedup)
  // still contribute to same-game badge detection. Key = makeGameMatchKey (gameId primary,
  // teamAbbr|opponentAbbr fallback).
  const sameGamePicksMap = useMemo(() => {
    const m = new Map<string, Array<{ playerName: string; statType: string; ppLineId: number }>>();
    const sourceRows = allRows.filter((r: any) => r.pickCategory !== "team" && r.pickCategory !== "culture");
    for (const r of sourceRows) {
      if (!r.isWatched && !pinnedIds.has(r.ppLineId)) continue;
      const key = makeGameMatchKey(r);
      if (!key) continue;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push({ playerName: r.playerName, statType: r.statType, ppLineId: r.ppLineId });
    }
    return m;
  }, [allRows, pinnedIds]);

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

    if (optSport !== "all") candidates = candidates.filter(r => r.sport === optSport);
    if (optMinEdge) candidates = candidates.filter(r => r.edgeScore != null && r.edgeScore >= parseFloat(optMinEdge));

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

    // Sort by strategy, then greedily select up to optPickCount picks while
    // respecting the maxPerTeam diversity cap. Picks with unknown teamAbbr
    // (null) are never capped — we can't enforce what we can't identify.
    // This same loop serves as both the main pass and the "relaxed fallback"
    // (there is no separate pass: if diversity constraints exhaust candidates
    // before the lineup is full, we just return what we have and show a note).
    const sorted = ceilingHunter
      ? [...candidates].sort((a, b) => (b.variance?.usageScore ?? 0) - (a.variance?.usageScore ?? 0))
      : [...candidates].sort((a, b) => (b.ourProjection?.pOver ?? 0) - (a.ourProjection?.pOver ?? 0));

    const goblinProps: typeof sorted = [];
    const teamCount = new Map<string, number>();
    const gameCount = new Map<number, number>();
    const gameCappedGames = new Map<number, { teamAbbr: string | null; opponentAbbr: string | null; excluded: number }>();
    for (const c of sorted) {
      if (goblinProps.length >= optPickCount) break;
      const team = c.teamAbbr ?? null;
      if (team != null) {
        const count = teamCount.get(team) ?? 0;
        if (count >= maxPerTeam) continue; // over cap for this team — skip
      }
      const gameId = c.gameId ?? null;
      if (gameId != null) {
        const gcount = gameCount.get(gameId) ?? 0;
        if (gcount >= maxPerGame) {
          const prev = gameCappedGames.get(gameId) ?? { teamAbbr: c.teamAbbr ?? null, opponentAbbr: c.opponentAbbr ?? null, excluded: 0 };
          gameCappedGames.set(gameId, { ...prev, excluded: prev.excluded + 1 });
          continue; // over cap for this game — skip
        }
        gameCount.set(gameId, gcount + 1);
      }
      if (team != null) {
        teamCount.set(team, (teamCount.get(team) ?? 0) + 1);
      }
      goblinProps.push(c);
    }

    const shortfall = optPickCount - goblinProps.length;
    if (shortfall > 0) {
      const base = `Only ${goblinProps.length} pick${goblinProps.length === 1 ? "" : "s"} available with current diversity setting`;
      const gameCappedTotal = [...gameCappedGames.values()].reduce((n, g) => n + g.excluded, 0);
      if (gameCappedTotal > 0) {
        const gameLabels = [...gameCappedGames.values()]
          .map(g => g.teamAbbr && g.opponentAbbr ? `${g.teamAbbr} vs ${g.opponentAbbr}` : null)
          .filter((l): l is string => l !== null);
        const capDetail = gameLabels.length > 0
          ? `${gameCappedTotal} excluded by per-game cap (${gameLabels.join(", ")})`
          : `${gameCappedTotal} excluded by per-game cap`;
        setDiversityNote(`${base} · ${capDetail} — raise the per-game cap or reduce pick count`);
      } else {
        setDiversityNote(`${base} — raise the "Max per team" cap or reduce pick count`);
      }
    } else {
      setDiversityNote(null);
    }

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
        opponentAbbr: r.opponentAbbr ?? null,
        gameId: r.gameId ?? null,
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
  }, [playerRows, optPickCount, maxPerTeam, maxPerGame, optSport, optMinEdge, userSettings, varianceEnabled]);

  function loadOptimizerToEntry() {
    for (const r of optResults) {
      if (!hasPick(r.ppLineId)) {
        addPick({
          ppLineId: r.ppLineId,
          playerId: r.playerId,
          playerName: r.playerName,
          imageUrl: r.imageUrl ?? null,
          teamAbbr: r.teamAbbr ?? null,
          gameId: r.gameId ?? null,
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
      {/* Data-readiness warning */}
      {readiness && !readiness.isDataReady && (
        <div className="flex items-start gap-3 px-4 py-2.5 rounded-lg border border-amber-700/50 bg-amber-900/10 text-amber-300 text-xs font-mono shrink-0">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            <strong>Model not seeded:</strong> only {readiness.playersWithLogs} player{readiness.playersWithLogs === 1 ? "" : "s"} have game logs (need 100+). Scores shown here may be unreliable — go to{" "}
            <strong>Settings → Step 3 Backfill History</strong> to populate the model.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="space-y-3 border-b border-border pb-4 shrink-0">
        {/* Row 1: title + tabs (left) · status badges / mobile controls (right) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="hidden sm:block text-2xl font-bold tracking-tight mr-4">Slates</h1>
            <button
              onClick={() => { setTab("player"); setActionTagFilter("all"); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono transition-colors ${tab === "player" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground bg-slate-800/50"}`}
            >
              <User className="w-3.5 h-3.5" /> Player Picks
              {tab === "player" && playerRows.length > 0 && (
                <span className="ml-1 bg-primary-foreground/20 text-xs px-1.5 rounded-full font-mono">{playerRows.length}</span>
              )}
            </button>
            <button
              onClick={() => { setTab("team"); setActionTagFilter("all"); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono transition-colors ${tab === "team" ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground bg-slate-800/50"}`}
            >
              <Users className="w-3.5 h-3.5" /> Team Picks
              <Badge className="ml-1 bg-violet-700 text-white text-[10px] px-1 py-0 font-mono">NEW</Badge>
            </button>
            <button
              onClick={() => { setTab("culture"); setActionTagFilter("all"); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono transition-colors ${tab === "culture" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground bg-slate-800/50"}`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Culture
              {tab === "culture" && cultureRows.length > 0 && (
                <span className="ml-1 bg-indigo-400/20 text-xs px-1.5 rounded-full font-mono">{cultureRows.length}</span>
              )}
              <Badge className="ml-1 bg-indigo-700 text-white text-[10px] px-1 py-0 font-mono">NEW</Badge>
            </button>
          </div>

          {tab === "team" && teamRows.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              {totalTeamRowCount !== null && (
                <span className="hidden md:inline font-mono text-[10px] text-slate-500 shrink-0">
                  {teamRows.length} / {totalTeamRowCount} rows
                </span>
              )}
              <span className="md:hidden font-mono text-[10px] text-slate-500 shrink-0">
                {totalTeamRowCount !== null
                  ? `${teamRows.length} / ${totalTeamRowCount} rows`
                  : `${teamRows.length} rows`}
              </span>
            </div>
          )}

          {tab === "culture" && cultureRows.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              {totalCultureRowCount !== null && (
                <span className="hidden md:inline font-mono text-[10px] text-slate-500 shrink-0">
                  {cultureRows.length} / {totalCultureRowCount} rows
                </span>
              )}
              <span className="md:hidden font-mono text-[10px] text-slate-500 shrink-0">
                {totalCultureRowCount !== null
                  ? `${cultureRows.length} / ${totalCultureRowCount} rows`
                  : `${cultureRows.length} rows`}
              </span>
            </div>
          )}

          {tab === "player" && (
            <div className="flex items-center gap-2 shrink-0">
              {/* desktop status badges */}
              <div className="hidden md:flex items-center gap-2">
                {/* PP lines freshness indicator */}
                <span
                  className={`font-mono text-[10px] flex items-center gap-1 ${
                    ppNeverSynced ? "text-rose-500/70" : ppStale ? "text-amber-400/80" : "text-slate-500"
                  }`}
                  title={boardFreshnessAt ? `PP lines last imported ${relativeTime(boardFreshnessAt)}` : "PP lines not yet imported — use Settings to import"}
                >
                  <Clock className="w-2.5 h-2.5 shrink-0" />
                  {ppNeverSynced
                    ? "PP · not synced"
                    : `PP · ${relativeTime(boardFreshnessAt!)}`}
                </span>
                <div className="h-3 border-l border-slate-800" />
                {watchCount > 0 && (
                  <button
                    onClick={() => setActionTagFilter(f => f === "WATCH" ? "all" : "WATCH")}
                    className={`font-mono text-xs px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                      actionTagFilter === "WATCH"
                        ? "bg-amber-900/60 border-amber-700/50 text-amber-300"
                        : "bg-amber-900/40 border-amber-700/40 text-amber-300 hover:bg-amber-900/60 hover:border-amber-700/50"
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    {actionTagFilter === "WATCH"
                      ? `${watchCount} / ${playerRows.length} watched`
                      : `${watchCount} watched`}
                  </button>
                )}
                {playCount > 0 && (
                  <button
                    onClick={() => setActionTagFilter(f => f === "PLAY" ? "all" : "PLAY")}
                    className={`font-mono text-xs px-2 py-0.5 rounded border transition-colors ${
                      actionTagFilter === "PLAY"
                        ? "bg-emerald-900/60 border-emerald-700/50 text-emerald-300"
                        : "bg-emerald-900/40 border-emerald-700/40 text-emerald-300 hover:bg-emerald-900/60 hover:border-emerald-700/50"
                    }`}
                  >
                    {actionTagFilter === "PLAY"
                      ? `${playCount} / ${playerRows.length} PLAY`
                      : `${playCount} PLAY`}
                  </button>
                )}
                {noPlayCount > 0 && (
                  <button
                    onClick={() => setActionTagFilter(f => f === "NO-PLAY" ? "all" : "NO-PLAY")}
                    className={`font-mono text-xs px-2 py-0.5 rounded border transition-colors ${
                      actionTagFilter === "NO-PLAY"
                        ? "bg-rose-900/60 border-rose-700/50 text-rose-300"
                        : "bg-rose-900/40 border-rose-700/40 text-rose-300 hover:bg-rose-900/60 hover:border-rose-700/50"
                    }`}
                  >
                    {actionTagFilter === "NO-PLAY"
                      ? `${noPlayCount} / ${playerRows.length} gated`
                      : `${noPlayCount} gated`}
                  </button>
                )}
                {pinnedIds.size > 0 && (
                  <span
                    className="font-mono text-xs px-2 py-0.5 rounded border bg-primary/10 border-primary/40 text-primary flex items-center gap-1"
                    title="Picks queued for Lineup Factory"
                  >
                    <Pin className="w-2.5 h-2.5 fill-primary" />
                    {pinnedIds.size} pinned
                  </span>
                )}
              </div>
              {totalPlayerRowCount !== null && (
                <span className="hidden md:inline font-mono text-[10px] text-slate-500 shrink-0">
                  {playerRows.length} / {totalPlayerRowCount} rows
                </span>
              )}
              {/* mobile filter toggle + sync — scrolls horizontally so chips never clip */}
              <div className="md:hidden flex items-center gap-2 overflow-x-auto scrollbar-none">
                <Button size="sm" variant="outline" onClick={() => setFilterOpen(true)} className="gap-1.5 font-mono text-xs border-slate-700 text-muted-foreground">
                  <Filter className="w-3.5 h-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold">{activeFilterCount}</span>
                  )}
                </Button>
                <ForceSyncButton />
                <span
                  className={`font-mono text-[10px] flex items-center gap-1 ${
                    ppNeverSynced ? "text-rose-500/70" : ppStale ? "text-amber-400/80" : "text-slate-500"
                  }`}
                  title={boardFreshnessAt ? `PP lines last imported ${relativeTime(boardFreshnessAt)}` : "PP lines not yet imported"}
                >
                  <Clock className="w-2.5 h-2.5 shrink-0" />
                  {ppNeverSynced ? "PP · not synced" : `PP · ${relativeTime(boardFreshnessAt!)}`}
                </span>
                {playerRows.length > 0 && (
                  <span className="font-mono text-[10px] text-slate-500 shrink-0">
                    {actionTagFilter !== "all"
                      ? `${actionTagFilter === "PLAY" ? playCount : actionTagFilter === "WATCH" ? watchCount : noPlayCount} / ${actionTagUnfilteredPlayerCount} rows`
                      : totalPlayerRowCount !== null
                        ? `${playerRows.length} / ${totalPlayerRowCount} rows`
                        : `${playerRows.length} rows`}
                  </span>
                )}
                {playCount > 0 && (
                  <button
                    onClick={() => setActionTagFilter(f => f === "PLAY" ? "all" : "PLAY")}
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      actionTagFilter === "PLAY"
                        ? "bg-emerald-900/60 border-emerald-700/50 text-emerald-300"
                        : "border-emerald-800/40 text-emerald-500/80"
                    }`}
                  >
                    {actionTagFilter === "PLAY" ? `${playCount} / ${playerRows.length} PLAY` : `${playCount} PLAY`}
                  </button>
                )}
                {watchCount > 0 && (
                  <button
                    onClick={() => setActionTagFilter(f => f === "WATCH" ? "all" : "WATCH")}
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      actionTagFilter === "WATCH"
                        ? "bg-amber-900/60 border-amber-700/50 text-amber-300"
                        : "border-amber-800/40 text-amber-500/80"
                    }`}
                  >
                    {actionTagFilter === "WATCH" ? `${watchCount} / ${playerRows.length} 👁` : `${watchCount} 👁`}
                  </button>
                )}
                {noPlayCount > 0 && (
                  <button
                    onClick={() => setActionTagFilter(f => f === "NO-PLAY" ? "all" : "NO-PLAY")}
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      actionTagFilter === "NO-PLAY"
                        ? "bg-rose-900/60 border-rose-700/50 text-rose-300"
                        : "border-rose-800/40 text-rose-500/80"
                    }`}
                  >
                    {actionTagFilter === "NO-PLAY" ? `${noPlayCount} / ${playerRows.length} gated` : `${noPlayCount} gated`}
                  </button>
                )}
                {pinnedIds.size > 0 && (
                  <span
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded border bg-primary/10 border-primary/40 text-primary flex items-center gap-1 shrink-0"
                    title="Picks queued for Lineup Factory"
                  >
                    <Pin className="w-2 h-2 fill-primary" />
                    {pinnedIds.size} pinned
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {tab === "player" && (
          <>

            {/* Mobile sport-filter pills — scrolls horizontally so pills never wrap */}
            <div className="md:hidden flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
              {(["all", "NBA", "NFL", "MLB", "NHL", "WNBA"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setSport(s); setActivePreset(null); }}
                  className={`shrink-0 px-2.5 py-0.5 rounded font-mono text-[11px] border transition-colors ${
                    sport === s
                      ? "bg-primary/20 text-primary border-primary/40"
                      : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
                  }`}
                >
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>

            {/* Quick-filter preset toolbar — only once unlocked (no locked-state noise) */}
            {presetsUnlocked && (
            <div className="flex overflow-x-auto items-center gap-1.5 py-0.5 md:flex-wrap scrollbar-none">
              <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Quick:</span>
              {DEFAULT_PRESETS.map(p => {
                const isActive = activePreset === p.label;
                const getSaved = () => { try { return (JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>)[p.label] ?? null; } catch { return null; } };
                const savedCfg = getSaved();
                const savedSport = savedCfg?.sport && savedCfg.sport !== "all" ? savedCfg.sport.toUpperCase() : null;
                const myStyleTooltip = p.label === "My Style" && savedCfg ? (() => {
                  const parts: string[] = [];
                  if (savedCfg.sport && savedCfg.sport !== "all") parts.push(savedCfg.sport.toUpperCase());
                  if (savedCfg.actionTag && savedCfg.actionTag !== "all") parts.push(savedCfg.actionTag);
                  if (savedCfg.lineType && savedCfg.lineType !== "all") parts.push(savedCfg.lineType.charAt(0).toUpperCase() + savedCfg.lineType.slice(1));
                  if (savedCfg.minEdge) parts.push(`Edge ≥${savedCfg.minEdge}`);
                  if (savedCfg.sharpOnly) parts.push("Sharp");
                  return parts.length ? parts.join(" · ") : null;
                })() : null;
                return (
                  <button
                    key={p.label}
                    title={myStyleTooltip ?? undefined}
                    onClick={() => {
                      if (isActive) { setSport("all"); setLineTypeFilter("all"); setMinEdge(""); setActionTagFilter("all"); setSharpOnly(false); setActivePreset(null); return; }
                      const cfg = getSaved() ?? p;
                      isPresetChangeRef.current = true;
                      if (cfg.sport !== undefined) setSport(cfg.sport);
                      if (cfg.lineType !== undefined) setLineTypeFilter(cfg.lineType); else setLineTypeFilter("all");
                      if (cfg.minEdge !== undefined) setMinEdge(cfg.minEdge); else setMinEdge("");
                      if (cfg.actionTag !== undefined) setActionTagFilter(cfg.actionTag); else setActionTagFilter("all");
                      if (cfg.sharpOnly !== undefined) setSharpOnly(cfg.sharpOnly); else setSharpOnly(false);
                      setActivePreset(p.label);
                    }}
                    className={`shrink-0 px-2 py-0.5 rounded font-mono text-[10px] border transition-colors ${isActive ? "bg-primary/20 text-primary border-primary/30" : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"}`}
                  >
                    {p.icon} {p.label}{savedSport && (
                      <span className="ml-1 text-[9px] text-cyan-400/80 font-mono inline-flex items-center gap-0.5">
                        · {savedSport}
                        <button
                          type="button"
                          aria-label={`Clear ${savedSport} pin from ${p.label}`}
                          onClick={e => {
                            e.stopPropagation();
                            try {
                              const saved = JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>;
                              if (saved[p.label]) {
                                const { sport: _s, ...rest } = saved[p.label];
                                if (Object.keys(rest).length) saved[p.label] = rest;
                                else delete saved[p.label];
                                localStorage.setItem(PRESET_LS_KEY, JSON.stringify(saved));
                              }
                            } catch {}
                            setPresetRevision(r => r + 1);
                          }}
                          className="ml-0.5 text-[8px] text-slate-500 hover:text-rose-400 leading-none bg-transparent border-0 p-0 cursor-pointer"
                        >✕</button>
                      </span>
                    )}
                  </button>
                );
              })}
              {presetsUnlocked && activePreset && (() => {
                const isMyStyle = activePreset === "My Style";
                const sportLabel = sport && sport !== "all" ? sport.toUpperCase() : null;
                if (isMyStyle) {
                  const parts: string[] = [];
                  if (sport && sport !== "all") parts.push(sport.toUpperCase());
                  if (actionTagFilter && actionTagFilter !== "all") parts.push(actionTagFilter);
                  const preview = parts.length ? ` ${parts.join("+")}` : "";
                  return (
                    <button
                      onClick={() => { try { const saved = JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>; saved[activePreset] = { sport, lineType: lineTypeFilter, minEdge, actionTag: actionTagFilter, sharpOnly }; localStorage.setItem(PRESET_LS_KEY, JSON.stringify(saved)); } catch {} }}
                      className="shrink-0 text-[10px] font-mono text-amber-400 hover:text-amber-300 px-1"
                      title={`Save current filters as ${activePreset}${preview ? `: ${parts.join(" + ")}` : ""}`}
                    >
                      💾 save{preview && <span className="text-amber-300/70">{preview}</span>}
                    </button>
                  );
                }
                // Safe / Upside / Late-News: only pin the sport; preserve the preset's built-in filter defaults
                return (
                  <button
                    onClick={() => {
                      try {
                        const saved = JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>;
                        const presetDef = DEFAULT_PRESETS.find(p => p.label === activePreset);
                        const { label: _l, icon: _i, ...defaults } = presetDef ?? { label: "", icon: "" };
                        saved[activePreset] = { ...defaults, sport };
                        localStorage.setItem(PRESET_LS_KEY, JSON.stringify(saved));
                      } catch {}
                    }}
                    className="shrink-0 text-[10px] font-mono text-amber-400 hover:text-amber-300 px-1"
                    title={sportLabel ? `Pin ${sportLabel} to ${activePreset} preset` : `Remove sport pin from ${activePreset}`}
                  >
                    📌 {sportLabel ? <>pin <span className="text-amber-300/70">· {sportLabel}</span></> : "unpin"}
                  </button>
                );
              })()}
              {presetsUnlocked && activePreset && (
                <button
                  onClick={() => { setSport("all"); setLineTypeFilter("all"); setMinEdge(""); setActionTagFilter("all"); setSharpOnly(false); setActivePreset(null); }}
                  className="shrink-0 text-[10px] font-mono text-slate-500 hover:text-rose-400 px-1"
                >
                  ✕ clear
                </button>
              )}
              {presetsUnlocked && (() => {
                try {
                  const saved = JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>;
                  const hasAnyPin = DEFAULT_PRESETS.some(p => saved[p.label]?.sport && saved[p.label].sport !== "all");
                  if (!hasAnyPin) return null;
                  return (
                    <button
                      onClick={() => {
                        try {
                          const s = JSON.parse(localStorage.getItem(PRESET_LS_KEY) ?? "{}") as Record<string, Partial<Preset>>;
                          DEFAULT_PRESETS.forEach(p => {
                            if (s[p.label]) {
                              const { sport: _sp, ...rest } = s[p.label];
                              if (Object.keys(rest).length) s[p.label] = rest;
                              else delete s[p.label];
                            }
                          });
                          localStorage.setItem(PRESET_LS_KEY, JSON.stringify(s));
                        } catch {}
                        setPresetRevision(r => r + 1);
                      }}
                      className="shrink-0 text-[10px] font-mono text-slate-500 hover:text-rose-400 px-1 border border-slate-800 rounded transition-colors"
                      title="Clear all sport pins from presets"
                    >
                      🗑 pins
                    </button>
                  );
                } catch { return null; }
              })()}
            </div>
            )}

            {/* Slate window picker — one pill per distinct game-start time, sorted
                chronologically. "Upcoming" (default) hides finished games. Picking a
                specific time slot shows only props from that game window. */}
            {windowGroups.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 flex-nowrap md:flex-wrap">
                <Clock className="w-3 h-3 text-slate-600 shrink-0" />
                <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider shrink-0">Slate:</span>

                {/* Upcoming — hides final games (default) */}
                <button
                  onClick={() => setSelectedWindow("upcoming")}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] border transition-colors ${
                    selectedWindow === "upcoming"
                      ? "bg-emerald-900/40 text-emerald-300 border-emerald-700/40"
                      : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
                  }`}
                >
                  Upcoming
                </button>

                {/* Per-window pills */}
                {windowGroups.map(w => {
                  const isSelected = selectedWindow === w.key;
                  const isFinal = w.gameStatus === "final";
                  const isLive  = w.gameStatus === "live";
                  const label = w.key === "__none__"
                    ? "No Game"
                    : formatWindowTime(w.startTime);
                  return (
                    <button
                      key={w.key}
                      onClick={() => setSelectedWindow(w.key)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] border transition-colors ${
                        isSelected
                          ? "bg-primary/20 text-primary border-primary/30"
                          : isFinal
                          ? "border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-600"
                          : isLive
                          ? "border-rose-800/50 text-rose-400 hover:border-rose-600 hover:text-rose-300"
                          : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
                      }`}
                    >
                      {isLive && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />}
                      {label}
                      <span className="opacity-50 ml-0.5">{w.count}</span>
                      {isFinal && <span className="opacity-40 text-[9px]">fin</span>}
                    </button>
                  );
                })}

                {/* All — shows every window including finished */}
                <button
                  onClick={() => setSelectedWindow("all")}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] border transition-colors ${
                    selectedWindow === "all"
                      ? "bg-primary/20 text-primary border-primary/30"
                      : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
                  }`}
                >
                  All
                </button>
              </div>
            )}

            {/* Mobile search */}
            <div className="md:hidden">
              <div className="relative">
                <Input
                  placeholder="Search player…"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  className="w-full bg-slate-900 border-slate-700 font-mono text-sm h-9 pr-8"
                />
                {searchInput && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearchInput("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Desktop: search + filters + actions — single wrapping row */}
            <div className="hidden md:flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Input
                  placeholder="Search player…"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  className="w-full bg-slate-900 border-slate-700 font-mono text-sm h-9 pr-8"
                />
                {searchInput && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearchInput("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Select value={sport} onValueChange={v => { setSport(v); }}>
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
              <div className="relative">
                <Button
                  onClick={runOptimizer}
                  size="sm"
                  className="font-mono text-xs bg-violet-700 hover:bg-violet-600 text-white gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5" /> {optLoaded ? "Re-run" : "Optimizer"}
                </Button>
                {pinnedIds.size > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] font-mono font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none pointer-events-none">
                    {pinnedIds.size}
                  </span>
                )}
              </div>
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
                  <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-center">
                    <Tooltip>
                      <TooltipTrigger className="cursor-help">Form</TooltipTrigger>
                      <TooltipContent className="text-xs max-w-xs">
                        Recency trend — z-score of last 5 games vs historical mean. ↑ hot (≥+0.5σ), ↓ cold (≤−0.5σ), — neutral.
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-center">
                    <Tooltip>
                      <TooltipTrigger className="cursor-help">Role</TooltipTrigger>
                      <TooltipContent className="text-xs max-w-xs">
                        Minutes role stability. ⚡ VOL = volatile (std dev &gt; 6 min), 🪑 BENCH = bench + volatile. Volatile players receive a risk score penalty.
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="hidden lg:table-cell w-20 font-mono text-xs text-center">Pace</TableHead>
                  {isNflSlate && <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-center">Snap%</TableHead>}
                  {isNflSlate && <TableHead className="hidden lg:table-cell w-20 font-mono text-xs text-center">Tgt Shr</TableHead>}
                  {isNflSlate && <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-center">WOPR</TableHead>}
                  <TableHead className="w-24 font-mono text-xs text-center">Action</TableHead>
                  <TableHead className="hidden lg:table-cell w-20 font-mono text-xs text-center">
                    <Tooltip>
                      <TooltipTrigger className="cursor-help">Tier / Stake</TooltipTrigger>
                      <TooltipContent className="text-xs max-w-xs space-y-1">
                        <p className="font-bold mb-1">Capital Allocation Tier</p>
                        <p><span className="text-violet-400 font-semibold">A (≥43% edge)</span> — Elite · 5 units</p>
                        <p><span className="text-emerald-400 font-semibold">B (≥30%)</span> — Core Portfolio · 2 units</p>
                        <p><span className="text-amber-400 font-semibold">C (20–30%)</span> — Exploratory · 1 unit</p>
                        <p className="text-slate-500">D (&lt;20%) — Low priority · 0 units</p>
                        <p className="text-slate-400 mt-1">Unit size set in Settings → Bankroll.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
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

                    // ── Bias-adjusted tag flip ──────────────────────────────────
                    const biasEnabled = userSettings?.biasCorrectionEnabled === true;
                    const bKeyRow = `${row.sport ?? ""}|${row.statType}|${row.lineType}`;
                    const bDeltaRow = biasEnabled ? (biasDeltaMap.get(bKeyRow) ?? null) : null;
                    const biasAdjEdge = bDeltaRow != null
                      ? (row.edgeScore ?? 0) + Math.max(-5, Math.min(5, bDeltaRow))
                      : null;
                    const biasFlipToPlay   = biasAdjEdge != null && biasAdjEdge >= 55 && (row.edgeScore ?? 0) < 55;
                    const biasFlipToAction = biasAdjEdge != null && biasAdjEdge >= 45 && (row.edgeScore ?? 0) < 45 && !biasFlipToPlay;
                    const biasFlipDown     = biasAdjEdge != null && biasAdjEdge < 55  && (row.edgeScore ?? 0) >= 55;

                    return (
                      <React.Fragment key={row.ppLineId}>
                      <TableRow
                        className={`border-slate-800 cursor-pointer transition-colors ${
                          isNoPlay ? "opacity-50 hover:opacity-70" :
                          biasFlipToPlay   ? "bg-emerald-950/20 hover:bg-emerald-950/30 border-l-2 border-l-emerald-600/60" :
                          biasFlipToAction ? "bg-sky-950/15 hover:bg-sky-950/25 border-l-2 border-l-sky-600/50" :
                          biasFlipDown     ? "bg-rose-950/10 hover:bg-rose-950/20 border-l-2 border-l-rose-700/40" :
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
                            <PinToOptimizerButton row={row} pinnedIds={pinnedIds} onToggle={setPinnedIds} />
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-primary">{row.sport}</TableCell>
                        <TableCell className="font-bold">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar name={row.playerName} imageUrl={row.imageUrl} size="sm" />
                            <div>
                              <div className="font-bold text-sm leading-tight flex items-center gap-1.5">
                                {row.playerName}
                                {(() => {
                                  const gKey = makeGameMatchKey(row);
                                  if (!gKey) return null;
                                  const gamePicks = sameGamePicksMap.get(gKey);
                                  if (!gamePicks) return null;
                                  const others = gamePicks.filter(p => p.ppLineId !== row.ppLineId);
                                  if (others.length === 0) return null;
                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-0.5 px-1 py-px bg-amber-900/50 border border-amber-600/50 rounded text-[9px] font-mono text-amber-400 cursor-help leading-none shrink-0">
                                          SGP
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="font-mono text-xs max-w-xs">
                                        <p className="text-amber-300 font-semibold mb-1">Same-game picks</p>
                                        {others.map(p => (
                                          <p key={p.ppLineId} className="text-slate-300">{p.playerName} · {p.statType}</p>
                                        ))}
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })()}
                              </div>
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
                            {row.bestTierInGroup && <BestValueBadge side={row.recommendedSide} />}
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

                        {/* Form — recency trend chip */}
                        <TableCell className="hidden lg:table-cell text-center font-mono text-xs">
                          {(() => {
                            const z = row.formZScore ?? null;
                            if (z === null) return <span className="text-slate-600">—</span>;
                            if (z >= 0.5) return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 text-emerald-400 font-bold cursor-help">
                                    ↑ <span className="text-[9px] text-emerald-500">HOT</span>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">{z > 0 ? "+" : ""}{z.toFixed(2)}σ above historical avg (last 5 games)</TooltipContent>
                              </Tooltip>
                            );
                            if (z <= -0.5) return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 text-rose-400 font-bold cursor-help">
                                    ↓ <span className="text-[9px] text-rose-500">COLD</span>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">{z.toFixed(2)}σ below historical avg (last 5 games)</TooltipContent>
                              </Tooltip>
                            );
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-slate-500 cursor-help">—</span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">{z > 0 ? "+" : ""}{z.toFixed(2)}σ — within normal range</TooltipContent>
                              </Tooltip>
                            );
                          })()}
                        </TableCell>

                        {/* Role stability badge */}
                        <TableCell className="hidden lg:table-cell text-center">
                          {(() => {
                            const rs = (row as Record<string, unknown>).roleStability as string | null | undefined;
                            if (!rs || rs === "starter" || rs === "rotation") return <span className="text-slate-600 text-xs">—</span>;
                            const isBench = rs === "bench_volatile";
                            const label = isBench ? "BENCH" : "VOL";
                            const icon = isBench ? "🪑" : "⚡";
                            const colorClass = isBench ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-amber-400 border-amber-500/30 bg-amber-500/10";
                            const mAvg = (row as Record<string, unknown>).minutesAvg as number | null | undefined;
                            const mStd = (row as Record<string, unknown>).minutesStdDev as number | null | undefined;
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={`inline-flex items-center gap-0.5 text-[9px] font-mono font-bold px-1 py-0.5 rounded border cursor-help ${colorClass}`}>
                                    {icon} {label}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs font-mono">
                                  {isBench ? "Bench / volatile role" : "Volatile minutes role"}
                                  {mAvg != null && mStd != null && (
                                    <div className="text-slate-400 mt-0.5">{mAvg.toFixed(1)} avg min · ±{mStd.toFixed(1)} σ</div>
                                  )}
                                  <div className="text-rose-400/80 mt-0.5">+{isBench ? 20 : 10} risk penalty applied</div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()}
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
                              {row.sharpSignal && row.sharpSignal !== "neutral" && (() => {
                                const isSharp = row.sharpSignal === "sharp";
                                const isFade  = row.sharpSignal === "fade";
                                const label   = isSharp ? "⚡ SHARP ↑" : "📊 FADE ↓";
                                const cls     = isSharp
                                  ? "text-emerald-400 bg-emerald-950/40 border-emerald-700/50"
                                  : "text-amber-400  bg-amber-950/30  border-amber-700/40";
                                const tipHeader = isSharp
                                  ? `Sharp Signal — ${row.sharpConfidence ?? "low"} confidence`
                                  : "Public Steam (Fade)";
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`font-mono text-[9px] font-bold px-1.5 py-px rounded border leading-none cursor-help ${cls}`}>
                                        {label}
                                        {isSharp && row.sharpConfidence === "high" && " ★"}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                      <p className={`font-bold mb-1 ${isSharp ? "text-emerald-400" : "text-amber-400"}`}>{tipHeader}</p>
                                      {isFade && <p className="text-slate-400 text-[10px] mb-1">Public consensus — no reverse-line movement detected. Consider fading.</p>}
                                      <p className="text-slate-300 leading-relaxed">{row.sharpExplanation ?? (isSharp ? "Sharp money detected." : "Public steam — potential fade target.")}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })()}
                              {(() => {
                                const adjs: ProjectionFactor[] = row.ourProjection?.adjustments ?? [];
                                const active = adjs.filter(a => Math.abs(a.factor - 1) >= 0.02);
                                if (active.length === 0) return null;
                                const combined = active.reduce((acc, a) => acc * a.factor, 1);
                                const pct = Math.round((combined - 1) * 100);
                                if (pct === 0) return null;
                                const pos = pct > 0;
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={`font-mono text-[9px] font-bold px-1 py-px rounded border leading-none cursor-help ${
                                        pos
                                          ? "text-sky-300 bg-sky-950/40 border-sky-700/40"
                                          : "text-orange-300 bg-orange-950/40 border-orange-700/40"
                                      }`}>
                                        {pos ? "+" : ""}{pct}%
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="font-mono text-xs max-w-xs space-y-1">
                                      <p className="font-bold text-slate-200 mb-1">Active Projection Factors</p>
                                      {active.map(a => (
                                        <div key={a.key}>
                                          <span className={`font-bold ${a.factor > 1 ? "text-sky-300" : "text-orange-300"}`}>
                                            {a.label} {a.factor > 1 ? "+" : ""}{Math.round((a.factor - 1) * 100)}%
                                          </span>
                                          <p className="text-slate-400 text-[10px] leading-snug">{a.explain}</p>
                                        </div>
                                      ))}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })()}
                              {bDeltaRow != null && (() => {
                                const bd = bDeltaRow;
                                const pos = bd >= 0;
                                return (
                                  <>
                                    {/* Numeric delta badge — always shown when bias data exists */}
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className={`font-mono text-[9px] font-bold px-1 py-px rounded border leading-none cursor-help ${
                                          pos
                                            ? "text-emerald-400 bg-emerald-950/40 border-emerald-700/40"
                                            : "text-rose-400 bg-rose-950/40 border-rose-700/40"
                                        }`}>
                                          {pos ? "+" : ""}{bd.toFixed(1)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                        <p className="font-bold mb-0.5">Personal Bias</p>
                                        <p className="text-slate-400">Your {row.statType} hit rate is {Math.abs(bd).toFixed(1)} pp {pos ? "above" : "below"} model expectations on {row.lineType} lines.</p>
                                        {!biasEnabled && <p className="text-slate-500 mt-0.5 italic">Enable Bias Correction in Settings to see tag flips.</p>}
                                        {biasEnabled && biasAdjEdge != null && <p className="text-slate-500 mt-0.5">Bias-adj edge: {biasAdjEdge.toFixed(1)} (raw: {(row.edgeScore ?? 0).toFixed(1)})</p>}
                                      </TooltipContent>
                                    </Tooltip>
                                    {/* ↑PLAY w/ bias — bias pushes edge past 55 */}
                                    {biasFlipToPlay && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="font-mono text-[9px] font-bold px-1 py-px rounded border text-emerald-300 bg-emerald-950/60 border-emerald-500/60 leading-none cursor-help whitespace-nowrap">↑PLAY w/ bias</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                          <p className="font-bold text-emerald-400 mb-0.5">Bias-Adjusted Upgrade → PLAY</p>
                                          <p className="text-slate-300">Raw edge {(row.edgeScore ?? 0).toFixed(1)} + bias {bd > 0 ? "+" : ""}{Math.max(-5, Math.min(5, bd)).toFixed(1)} pp = <span className="text-emerald-300 font-bold">{biasAdjEdge!.toFixed(1)}</span> (≥55 PLAY threshold).</p>
                                          <p className="text-slate-400 mt-0.5">Your personal hit-rate edge on {row.statType} {row.lineType} lines crosses this into PLAY territory for you.</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {/* ↑ACTION w/ bias — bias pushes edge past 45 but not 55 */}
                                    {biasFlipToAction && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="font-mono text-[9px] font-bold px-1 py-px rounded border text-sky-300 bg-sky-950/50 border-sky-600/50 leading-none cursor-help whitespace-nowrap">↑ACTION w/ bias</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                          <p className="font-bold text-sky-400 mb-0.5">Bias-Adjusted Upgrade → ACTION</p>
                                          <p className="text-slate-300">Raw edge {(row.edgeScore ?? 0).toFixed(1)} + bias +{Math.max(-5, Math.min(5, bd)).toFixed(1)} pp = <span className="text-sky-300 font-bold">{biasAdjEdge!.toFixed(1)}</span> (≥45 ACTION threshold).</p>
                                          <p className="text-slate-400 mt-0.5">Your hit-rate edge on {row.statType} {row.lineType} lines elevates this above the ACTION threshold for you.</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {/* ↓PLAY w/ bias — bias pulls a PLAY below 55 */}
                                    {biasFlipDown && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="font-mono text-[9px] font-bold px-1 py-px rounded border text-rose-300 bg-rose-950/50 border-rose-600/50 leading-none cursor-help whitespace-nowrap">↓PLAY w/ bias</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                          <p className="font-bold text-rose-400 mb-0.5">Bias Warning — Weakened PLAY</p>
                                          <p className="text-slate-300">Raw edge {(row.edgeScore ?? 0).toFixed(1)} − bias {Math.abs(Math.max(-5, Math.min(5, bd))).toFixed(1)} pp = <span className="text-rose-300 font-bold">{biasAdjEdge!.toFixed(1)}</span> (below 55 PLAY threshold).</p>
                                          <p className="text-slate-400 mt-0.5">Your personal shortfall on {row.statType} {row.lineType} lines pulls this below PLAY territory for you.</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </TableCell>

                        {/* Tier / Stake cell */}
                        {(() => {
                          const edge = row.edgeScore ?? 0;
                          const unit = parseFloat(userSettings?.unitSize ?? "5");
                          let tier: string, units: number, cls: string;
                          if (edge >= 43) {
                            tier = "A"; units = 5; cls = "text-violet-400 border-violet-700/50 bg-violet-950/30";
                          } else if (edge >= 30) {
                            tier = "B"; units = 2; cls = "text-emerald-400 border-emerald-800/50 bg-emerald-950/30";
                          } else if (edge >= 20) {
                            tier = "C"; units = 1; cls = "text-amber-400 border-amber-700/40 bg-amber-950/20";
                          } else {
                            tier = "D"; units = 0; cls = "text-slate-600 border-slate-700/30 bg-transparent";
                          }
                          return (
                            <TableCell className="hidden lg:table-cell text-center">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className={`inline-flex flex-col items-center border rounded px-1.5 py-0.5 cursor-help ${cls}`}>
                                    <span className="font-mono font-bold text-xs leading-tight">{tier}</span>
                                    {units > 0 && <span className="font-mono text-[9px] leading-tight opacity-80">${(unit * units).toFixed(0)}</span>}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="font-mono text-xs max-w-xs">
                                  <p className="font-bold mb-0.5">Tier {tier} — {units > 0 ? `${units}u = $${(unit * units).toFixed(2)}` : "Low priority"}</p>
                                  <p className="text-slate-400">Edge: {edge.toFixed(1)}%</p>
                                  {tier === "A" && <p className="text-slate-400 mt-0.5">Top 5% model confidence. ~94% historical hit rate.</p>}
                                  {tier === "B" && <p className="text-slate-400 mt-0.5">Top 20% — primary recommendation tier. ~83% hit rate.</p>}
                                  {tier === "C" && <p className="text-slate-400 mt-0.5">Exploratory. Lower priority. Use to fill lineup gaps.</p>}
                                  {tier === "D" && <p className="text-slate-400 mt-0.5">Below 20% edge. Low priority — use advanced mode to show.</p>}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                          );
                        })()}

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
        tab === "team"
          ? <TeamPicksBoard rows={teamRows} isLoading={isLoading} onSelectProp={setSelectedPropId} />
          : <CulturePicksBoard rows={cultureRows} isLoading={isLoading} onSelectProp={setSelectedPropId} />
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
              <Select value={sport} onValueChange={v => { setSport(v); }}>
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
                onClick={() => { setOptPickCount(n); setOptLoaded(false); try { localStorage.setItem("opt-pick-count", String(n)); } catch {} }}
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

          {/* Team-diversity guard stepper */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-mono text-muted-foreground">Max per team:</span>
            {[1, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => { setMaxPerTeam(n); setOptLoaded(false); try { localStorage.setItem("opt-max-per-team", String(n)); } catch {} }}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  maxPerTeam === n
                    ? "bg-violet-700 text-white"
                    : "bg-slate-800 text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-[10px] font-mono text-slate-600 ml-1">per-team cap</span>
          </div>

          {/* Game-correlation cap stepper */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-mono text-muted-foreground">Max per game:</span>
            {[1, 2, 3, 4].map(n => (
              <button
                key={n}
                onClick={() => { setMaxPerGame(n); setOptLoaded(false); try { localStorage.setItem("opt-max-per-game", String(n)); } catch {} }}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  maxPerGame === n
                    ? "bg-violet-700 text-white"
                    : "bg-slate-800 text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-[10px] font-mono text-slate-600 ml-1">per-game cap</span>
          </div>

          {/* Sport filter + Min-edge filter */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-mono text-muted-foreground">Sport:</span>
            <Select
              value={optSport}
              onValueChange={v => { setOptSport(v); setOptLoaded(false); try { localStorage.setItem("opt-sport", v); } catch {} }}
            >
              <SelectTrigger className="w-32 bg-slate-800 border-slate-700 font-mono text-xs h-7">
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
            <span className="text-xs font-mono text-muted-foreground ml-2">Min Edge:</span>
            <Input
              placeholder="e.g. 5"
              value={optMinEdge}
              onChange={e => { setOptMinEdge(e.target.value); setOptLoaded(false); try { localStorage.setItem("opt-min-edge", e.target.value); } catch {}; }}
              className="w-20 bg-slate-800 border-slate-700 font-mono text-xs h-7 px-2"
            />
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

          {/* Diversity shortfall note */}
          {optLoaded && diversityNote && (
            <div className="text-[10px] font-mono text-amber-400 bg-amber-950/20 border border-amber-700/30 rounded px-2 py-1 mb-2">
              ⚠ {diversityNote}
            </div>
          )}

          {/* Game-correlation guard */}
          {optLoaded && (() => {
            const correlations = getGameCorrelations(optResults);
            if (correlations.length === 0) return null;
            const totalCorrelated = correlations.reduce((n, c) => n + c.count, 0);
            const gameWord = correlations.length === 1 ? "game" : "games";
            return (
              <div className="text-[10px] font-mono text-amber-400 bg-amber-950/20 border border-amber-700/30 rounded px-2 py-1.5 mb-2 space-y-0.5">
                <div>⚠ {totalCorrelated} picks from the same {gameWord} (correlated risk)</div>
                {correlations.map(c => {
                  const matchup = c.teamAbbr && c.opponentAbbr
                    ? `${c.teamAbbr} vs ${c.opponentAbbr}`
                    : `Game #${c.gameId}`;
                  return (
                    <div key={c.gameId} className="text-slate-500 pl-2">
                      {matchup}: {c.players.join(", ")}
                    </div>
                  );
                })}
              </div>
            );
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
