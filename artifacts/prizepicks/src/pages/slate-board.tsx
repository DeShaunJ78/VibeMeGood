import { useState } from "react";
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
import { LineTypeBadge, ActionTagBadge, POverBadge, DQBadge } from "@/components/ui/badges";
import { PropDetailSheet } from "@/components/prop-detail-sheet";
import { TeamPicksBoard } from "@/components/team-picks-board";
import { Users, User, Eye, EyeOff, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  edgeScore: number | null;
  actionTag: string | null;
  ourProjection: OurProjection | null;
  streak: { count: number; type: string | null } | null;
  recentMoves: { book: string; from: unknown; to: unknown; direction: string | null; at: unknown }[];
  scoring: Record<string, unknown> | null;
};

function useMarketIntel(params: Record<string, string | undefined>) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return useQuery<MarketIntelRow[]>({
    queryKey: ["market-intel", params],
    queryFn: async () => {
      const r = await fetch(`${base}/api/market-intel?${qs}`);
      if (!r.ok) throw new Error("market-intel fetch failed");
      return r.json();
    },
    staleTime: 60_000,
  });
}

function ForceSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function forceSync() {
    setSyncing(true);
    try {
      await fetch(`${base}/api/sync/all`, { method: "POST" });
      toast({ title: "Sync started", description: "Pulling live props + computing projections…" });
      setTimeout(() => { qc.invalidateQueries(); setSyncing(false); }, 15000);
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
      setSyncing(false);
    }
  }

  return (
    <Button
      size="sm" variant="outline" onClick={forceSync} disabled={syncing}
      className="gap-1.5 font-mono text-xs border-primary/30 text-primary hover:bg-primary/10"
    >
      <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "Syncing…" : "Force Sync"}
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

export default function SlateBoard() {
  const [tab, setTab] = useState<"player" | "team">("player");
  const [sport, setSport] = useState<string>("all");
  const [lineTypeFilter, setLineTypeFilter] = useState<string>("all");
  const [minEdge, setMinEdge] = useState<string>("");
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);

  const slateParams = {
    sport: sport !== "all" ? sport : undefined,
  };

  const miParams: Record<string, string | undefined> = {
    sport: sport !== "all" ? sport : undefined,
    lineType: lineTypeFilter !== "all" ? lineTypeFilter : undefined,
  };

  const { data: slate, isLoading: slateLoading } = useGetSlate(slateParams, {
    query: { queryKey: getGetSlateQueryKey(slateParams) },
  });

  const { data: marketIntel, isLoading: miLoading } = useMarketIntel(miParams);

  const isLoading = slateLoading || miLoading;

  // Merge market-intel into slate rows by ppLineId
  const miMap = new Map<number, MarketIntelRow>((marketIntel ?? []).map(r => [r.ppLineId, r]));

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
    };
  });

  // Market-intel rows not in slate (new from live sync)
  const slateIds = new Set((slate ?? []).map((r: any) => r.ppLineId));
  const miOnlyRows: any[] = (marketIntel ?? [])
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
    }));

  const allRows = [...mergedRows, ...miOnlyRows];

  let playerRows = allRows.filter((r) => r.pickCategory !== "team");
  let teamRows = allRows.filter((r) => r.pickCategory === "team");

  if (lineTypeFilter !== "all") playerRows = playerRows.filter(r => r.lineType === lineTypeFilter);
  if (minEdge) playerRows = playerRows.filter(r => r.edgeScore != null && r.edgeScore >= parseFloat(minEdge));

  // Default sort: highest model P(Over) first, then by edge score
  playerRows = [...playerRows].sort((a, b) => {
    const aPOver = a.ourProjection?.pOver ?? -1;
    const bPOver = b.ourProjection?.pOver ?? -1;
    if (bPOver !== aPOver) return bPOver - aPOver;
    return (b.edgeScore ?? 0) - (a.edgeScore ?? 0);
  });

  const watchCount = playerRows.filter(r => r.isWatched).length;
  const noPlayCount = playerRows.filter(r => r.actionTag === "NO-PLAY").length;
  const playCount = playerRows.filter(r => r.actionTag === "PLAY").length;
  const notSynced = !marketIntel || marketIntel.length === 0;

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
          <div className="flex items-center gap-2">
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
            <ForceSyncButton />
          </div>
        )}
      </div>

      {/* Not synced banner */}
      {notSynced && !isLoading && (
        <div className="flex items-center gap-2 text-amber-400 bg-amber-950/20 border border-amber-700/30 rounded px-3 py-2 text-sm font-mono">
          <AlertCircle className="w-4 h-4 shrink-0" />
          No live data yet — click <span className="font-bold mx-1">Force Sync</span> to pull props from PrizePicks.
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
                  <TableHead className="font-mono text-xs">Player</TableHead>
                  <TableHead className="w-12 font-mono text-xs">Team</TableHead>
                  <TableHead className="w-12 font-mono text-xs">Opp</TableHead>
                  <TableHead className="w-28 font-mono text-xs">Stat</TableHead>
                  <TableHead className="w-16 font-mono text-xs text-right">PP Line</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-center">Type</TableHead>
                  <TableHead className="w-16 font-mono text-xs text-right">Mkt Avg</TableHead>
                  <TableHead className="w-22 font-mono text-xs text-right">True Edge</TableHead>
                  <TableHead className="w-28 font-mono text-xs text-right">Our Proj</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-center">P(Over)</TableHead>
                  <TableHead className="w-14 font-mono text-xs text-center">Streak</TableHead>
                  <TableHead className="w-24 font-mono text-xs text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-800">
                      {Array.from({ length: 14 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-800" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : playerRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="h-48 text-center text-muted-foreground font-mono">
                      No props — click Force Sync to load live slate
                    </TableCell>
                  </TableRow>
                ) : (
                  playerRows.map((row) => {
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
                          <div className="flex items-center gap-1.5">
                            {row.playerName}
                            {proj?.dataQualityScore != null && !isNoPlay && (
                              <DQBadge score={proj.dataQualityScore} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.teamAbbr ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.opponentAbbr ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{row.statType}</TableCell>
                        <TableCell className="font-mono text-sm font-bold text-right text-cyan-400">{row.lineValue}</TableCell>
                        <TableCell className="text-center"><LineTypeBadge type={row.lineType} /></TableCell>

                        {/* Market avg */}
                        <TableCell className="font-mono text-xs text-right">
                          {row.marketDataStatus === "not_synced" ? (
                            <span className="text-slate-600">—</span>
                          ) : row.marketAvg != null ? (
                            <span className="text-slate-300">{row.marketAvg.toFixed(1)}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TableCell>

                        {/* True edge */}
                        <TableCell className="font-mono text-xs text-right">
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

                        {/* Our projection */}
                        <TableCell className="text-right">
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
                        <TableCell className="text-center font-mono text-xs">
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
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <TeamPicksBoard rows={teamRows} isLoading={isLoading} onSelectProp={setSelectedPropId} />
      )}

      <PropDetailSheet
        ppLineId={selectedPropId}
        open={!!selectedPropId}
        onOpenChange={open => !open && setSelectedPropId(null)}
      />
    </div>
  );
}
