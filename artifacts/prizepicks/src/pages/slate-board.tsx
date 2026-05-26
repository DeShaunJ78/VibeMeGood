import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  useGetSlate, getGetSlateQueryKey,
  useAddToWatchlist, useRemoveFromWatchlist,
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
import { Users, User, Eye, EyeOff, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Minus, Zap, ArrowRight, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEntry, type EntryPick } from "@/lib/entry-context";
import { VarianceBadge } from "@/components/ui/variance-badge";
import { useUserSettings } from "@/hooks/use-user-settings";
import { PlayerAvatar } from "@/components/ui/player-avatar";

type OurProjection = {
  value: number;
  stdDev: number | null;
  pOver: number | null;
  percentileAtLine: number | null;
  noPlayReason: string | null;
  dataQualityScore: number | null;
  sourceLabel: string | null;
  confidence: string | null;
  gamesUsed: number | null;
  shrinkageFactor: number | null;
  isStale: boolean;
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
};

type MarketIntelPage = {
  data: MarketIntelRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

function useMarketIntel(params: Record<string, string | undefined>, page: number) {
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-end gap-1 cursor-help">
          <span className="font-mono text-xs text-violet-300">{proj.value.toFixed(1)}</span>
          <span className={`font-mono text-[10px] ${gapColor} flex items-center gap-0.5`}>
            <GapIcon className="w-2.5 h-2.5" />
            {gap > 0 ? "+" : ""}{gap.toFixed(1)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-xs max-w-xs">
        <p>{tooltipContent}</p>
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

export default function SlateBoard() {
  const { data: userSettings } = useUserSettings();
  const varianceEnabled = userSettings?.varianceIntelEnabled ?? false;
  const [tab, setTab] = useState<"player" | "team">("player");
  const [sport, setSport] = useState<string>("all");
  const [lineTypeFilter, setLineTypeFilter] = useState<string>("all");
  const [minEdge, setMinEdge] = useState<string>("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [optimizerOpen, setOptimizerOpen] = useState(false);

  const activeFilterCount = [sport !== "all" && sport, lineTypeFilter !== "all" && lineTypeFilter, minEdge].filter(Boolean).length;
  const [optPickCount, setOptPickCount] = useState(4);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(75);
  const [sortCol, setSortCol] = useState<string>("projGap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  const miParams: Record<string, string | undefined> = {
    sport: sport !== "all" ? sport : undefined,
    lineType: lineTypeFilter !== "all" ? lineTypeFilter : undefined,
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

  const { data: slate, isLoading: slateLoading } = useGetSlate(slateParams, {
    query: { queryKey: getGetSlateQueryKey(slateParams) },
  });

  const { data: miPageData, isLoading: miLoading } = useMarketIntel(miParams, miPage);

  // Accumulate pages as they load
  useEffect(() => {
    if (!miPageData) return;
    setAllMiRows(prev => miPage === 1 ? miPageData.data : [...prev, ...miPageData.data]);
    setMiTotal(miPageData.total);
    setMiHasMore(miPageData.hasMore);
  }, [miPageData, miPage]);

  // Only block on skeleton for the very first page
  const isLoading = slateLoading || (miPage === 1 && miLoading);

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
      scoring: mi?.scoring ?? null,
      variance: mi?.variance ?? null,
      fairProb: mi?.fairProb ?? null,
      marketHoldPct: mi?.marketHoldPct ?? null,
      holdRating: mi?.holdRating ?? null,
      bookHolds: mi?.bookHolds ?? [],
    };
  });

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
      isWatched: false,
      watchlistId: null,
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
      scoring: mi.scoring,
      variance: mi.variance ?? null,
      fairProb: mi.fairProb ?? null,
      marketHoldPct: mi.marketHoldPct ?? null,
      holdRating: mi.holdRating ?? null,
      bookHolds: mi.bookHolds ?? [],
    }));

  const allRows = [...mergedRows, ...miOnlyRows];
  const teamRows = allRows.filter((r) => r.pickCategory === "team");
  const notSynced = allMiRows.length === 0 && !miLoading;

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
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "playerName": cmp = (a.playerName ?? "").localeCompare(b.playerName ?? ""); break;
        case "statType":   cmp = (a.statType ?? "").localeCompare(b.statType ?? ""); break;
        case "ppLine":     cmp = (a.lineValue ?? 0) - (b.lineValue ?? 0); break;
        case "ourProj":    cmp = (a.ourProjection?.value ?? -1) - (b.ourProjection?.value ?? -1); break;
        case "projGap": {
          const ga = a.ourProjection ? a.ourProjection.value - a.lineValue : -999;
          const gb = b.ourProjection ? b.ourProjection.value - b.lineValue : -999;
          cmp = ga - gb; break;
        }
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
  }, [allRows, lineTypeFilter, minEdge, searchQuery, sortCol, sortDir]);

  const watchCount  = useMemo(() => playerRows.filter(r => r.isWatched).length,   [playerRows]);
  const noPlayCount = useMemo(() => playerRows.filter(r => r.actionTag === "NO-PLAY").length, [playerRows]);
  const playCount   = useMemo(() => playerRows.filter(r => r.actionTag === "PLAY").length,    [playerRows]);
  const visibleRows = useMemo(() => playerRows.slice(0, visibleCount), [playerRows, visibleCount]);

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

    let candidates = playerRows.filter(
      r => r.lineType === "goblin" && r.ourProjection?.pOver != null && r.ourProjection.pOver > 50,
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
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight mr-4">Slate Board</h1>
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
          <>
            {/* Mobile: filter toggle + sync button */}
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

            {/* Desktop: full filter row */}
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
                </SelectContent>
              </Select>
              <Select value={lineTypeFilter} onValueChange={setLineTypeFilter}>
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
              <Input
                placeholder="Min Edge"
                value={minEdge}
                onChange={e => setMinEdge(e.target.value)}
                className="w-24 bg-slate-900 border-slate-800 font-mono text-sm"
              />
              <Input
                placeholder="Search player…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="w-36 bg-slate-900 border-slate-800 font-mono text-sm"
              />
              <Button
                onClick={runOptimizer}
                size="sm"
                className="font-mono text-xs bg-violet-700 hover:bg-violet-600 text-white gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" /> {optLoaded ? "Re-run" : "Optimizer"}
              </Button>
              <SyncProjectionsButton />
              <ForceSyncButton />
            </div>
          </>
        )}
      </div>

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
                  <SortTh col="trueEdge" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-22 text-right">
                    <Tooltip>
                      <TooltipTrigger className="cursor-pointer">True Edge{sortCol === "trueEdge" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</TooltipTrigger>
                      <TooltipContent className="text-xs max-w-xs">
                        Our model P(over) vs consensus no-vig market probability. Vig stripped from external book lines.
                      </TooltipContent>
                    </Tooltip>
                  </SortTh>
                  <TableHead className="hidden lg:table-cell w-16 font-mono text-xs text-right">Hold%</TableHead>
                  <SortTh col="projGap" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-28 text-right" label="Our Proj ⇕" />
                  <SortTh col="pOver" label="P(Over)" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="w-20 text-center" />
                  <TableHead className="hidden md:table-cell w-14 font-mono text-xs text-center">Streak</TableHead>
                  <TableHead className="w-24 font-mono text-xs text-center">Action</TableHead>
                  {varianceEnabled && <SortTh col="fatigue" label="Fatigue" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-22 text-center" />}
                  {varianceEnabled && <SortTh col="blowout" label="Blowout%" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className="hidden lg:table-cell w-22 text-center" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-800">
                      {Array.from({ length: varianceEnabled ? 18 : 16 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-800" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : playerRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={varianceEnabled ? 18 : 16} className="h-48 text-center text-muted-foreground font-mono">
                      No props — click Force Sync to load live slate
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => {
                    const isNoPlay = row.actionTag === "NO-PLAY";
                    const proj: OurProjection | null = row.ourProjection ?? null;

                    return (
                      <TableRow
                        key={row.ppLineId}
                        className={`border-slate-800 cursor-pointer transition-colors ${
                          isNoPlay ? "opacity-50 hover:opacity-70" :
                          row.isWatched ? "bg-amber-950/10 hover:bg-amber-950/20" :
                          "hover:bg-slate-800/50"
                        }`}
                        onClick={() => setSelectedPropId(row.ppLineId)}
                      >
                        <TableCell onClick={e => e.stopPropagation()} className="pr-0">
                          <WatchToggle row={row} slateParams={slateParams} />
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
                        <TableCell className="font-mono text-sm font-bold text-right text-cyan-400">{row.lineValue}</TableCell>
                        <TableCell className="text-center"><LineTypeBadge type={row.lineType} /></TableCell>

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

                        {/* True edge */}
                        <TableCell className="hidden lg:table-cell font-mono text-xs text-right">
                          {row.marketDataStatus === "not_synced" ? (
                            <span className="text-slate-600 text-[10px]">no data</span>
                          ) : row.trueEdge != null ? (
                            <span className={`font-bold flex items-center justify-end gap-0.5 ${row.trueEdge > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              <MarketStatusDot status={row.marketDataStatus} />
                              {row.trueEdge > 0 ? "+" : ""}{row.trueEdge.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-slate-600 text-[10px]">no data</span>
                          )}
                        </TableCell>

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
                          <ProjectionCell proj={proj} ppLine={row.lineValue} />
                        </TableCell>

                        {/* P(over) */}
                        <TableCell className="text-center">
                          <POverBadge
                            pOver={proj?.pOver}
                            noPlayReason={proj?.noPlayReason}
                          />
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
                            <ActionTagBadge tag={row.actionTag} />
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

      <PropDetailSheet
        ppLineId={selectedPropId}
        open={!!selectedPropId}
        onOpenChange={open => !open && setSelectedPropId(null)}
      />

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
