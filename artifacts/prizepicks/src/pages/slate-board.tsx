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
import { LineTypeBadge, ActionTagBadge } from "@/components/ui/badges";
import { PropDetailSheet } from "@/components/prop-detail-sheet";
import { TeamPicksBoard } from "@/components/team-picks-board";
import { Search, Users, User, Eye, EyeOff, RefreshCw, TrendingUp, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  marketDataStatus: "available" | "partial" | "unavailable" | "not_synced";
  edgeScore: number | null;
  actionTag: string | null;
  ourProjection: { value: number; confidence: string | null; gamesUsed: number | null } | null;
  streak: { count: number; type: string | null } | null;
  recentMoves: { book: string; from: unknown; to: unknown; direction: string | null; at: unknown }[];
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
      toast({ title: "Sync started", description: "Pulling live PrizePicks data…" });
      setTimeout(() => {
        qc.invalidateQueries();
        setSyncing(false);
      }, 12000);
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
      setSyncing(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={forceSync}
      disabled={syncing}
      className="gap-1.5 font-mono text-xs border-primary/30 text-primary hover:bg-primary/10"
    >
      <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "Syncing…" : "Force Sync"}
    </Button>
  );
}

function MarketStatusDot({ status }: { status: MarketIntelRow["marketDataStatus"] }) {
  const cfg = {
    available:  { color: "bg-emerald-400", label: "Market data live" },
    partial:    { color: "bg-amber-400",   label: "Partial market data" },
    unavailable:{ color: "bg-rose-400",    label: "No market data" },
    not_synced: { color: "bg-slate-500",   label: "Never synced" },
  }[status];
  return (
    <span title={cfg.label} className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.color} mr-1`} />
  );
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return <span className="text-muted-foreground">—</span>;
  const cfg = {
    high:   "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
    medium: "bg-amber-900/40 text-amber-400 border-amber-700/40",
    low:    "bg-rose-900/40 text-rose-400 border-rose-700/40",
  }[confidence] || "bg-slate-800 text-slate-400";
  return (
    <span className={`text-[10px] font-mono border px-1 rounded ${cfg}`}>{confidence}</span>
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
  const [actionTag, setActionTag] = useState<string>("all");
  const [minEdge, setMinEdge] = useState<string>("");
  const [lineTypeFilter, setLineTypeFilter] = useState<string>("all");
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);

  const slateParams = {
    sport: sport !== "all" ? sport : undefined,
    actionTag: actionTag !== "all" ? actionTag : undefined,
    minEdgeScore: minEdge ? parseFloat(minEdge) : undefined,
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
      // Prefer market-intel edge data when available
      marketAvg: mi?.marketAvg ?? null,
      trueEdge: mi?.trueEdge ?? null,
      bookLines: mi?.bookLines ?? {},
      marketDataStatus: mi?.marketDataStatus ?? "not_synced",
      edgeScore: mi?.edgeScore ?? row.edgeScore,
      actionTag: mi?.actionTag ?? row.actionTag,
      ourProjection: mi?.ourProjection ?? null,
      streak: mi?.streak ?? null,
      recentMoves: mi?.recentMoves ?? [],
    };
  });

  // If market-intel has rows not in slate, include them too
  const slateIds = new Set((slate ?? []).map((r: any) => r.ppLineId));
  const miOnlyRows: any[] = [];
  for (const mi of marketIntel ?? []) {
    if (!slateIds.has(mi.ppLineId)) {
      miOnlyRows.push({
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
        yourProjection: null,
        projectionGap: null,
        marketAvg: mi.marketAvg,
        trueEdge: mi.trueEdge,
        bookLines: mi.bookLines,
        marketDataStatus: mi.marketDataStatus,
        edgeScore: mi.edgeScore,
        actionTag: mi.actionTag,
        ourProjection: mi.ourProjection,
        streak: mi.streak,
        recentMoves: mi.recentMoves,
      });
    }
  }

  const allRows = [...mergedRows, ...miOnlyRows];

  let playerRows = allRows.filter((r) => r.pickCategory !== "team");
  let teamRows = allRows.filter((r) => r.pickCategory === "team");

  // Client-side filters
  if (lineTypeFilter !== "all") playerRows = playerRows.filter((r) => r.lineType === lineTypeFilter);
  if (minEdge) playerRows = playerRows.filter((r) => r.edgeScore != null && r.edgeScore >= parseFloat(minEdge));

  const watchCount = playerRows.filter((r) => r.isWatched).length;
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

      {/* Not synced warning */}
      {notSynced && !isLoading && (
        <div className="flex items-center gap-2 text-amber-400 bg-amber-950/20 border border-amber-700/30 rounded px-3 py-2 text-sm font-mono">
          <AlertCircle className="w-4 h-4 shrink-0" />
          No live data yet. Click <span className="font-bold">Force Sync</span> to pull props from PrizePicks.
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
                  <TableHead className="w-14 font-mono text-xs">Team</TableHead>
                  <TableHead className="w-14 font-mono text-xs">Opp</TableHead>
                  <TableHead className="w-28 font-mono text-xs">Stat</TableHead>
                  <TableHead className="w-16 font-mono text-xs text-right">PP Line</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-center">Type</TableHead>
                  <TableHead className="w-16 font-mono text-xs text-right">Mkt Avg</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-right">True Edge</TableHead>
                  <TableHead className="w-24 font-mono text-xs text-right">Our Proj</TableHead>
                  <TableHead className="w-16 font-mono text-xs text-right">Streak</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-800">
                      {Array.from({ length: 13 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-800" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : playerRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="h-48 text-center text-muted-foreground font-mono">
                      No props — click Force Sync to load live slate
                    </TableCell>
                  </TableRow>
                ) : (
                  playerRows.map((row) => (
                    <TableRow
                      key={row.ppLineId}
                      className={`border-slate-800 cursor-pointer transition-colors ${row.isWatched ? "bg-amber-950/10 hover:bg-amber-950/20" : "hover:bg-slate-800/50"}`}
                      onClick={() => setSelectedPropId(row.ppLineId)}
                    >
                      <TableCell onClick={e => e.stopPropagation()} className="pr-0">
                        <WatchToggle row={row} slateParams={slateParams} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-primary">{row.sport}</TableCell>
                      <TableCell className="font-bold">{row.playerName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.teamAbbr ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.opponentAbbr ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.statType}</TableCell>
                      <TableCell className="font-mono text-sm font-bold text-right text-cyan-400">{row.lineValue}</TableCell>
                      <TableCell className="text-center"><LineTypeBadge type={row.lineType} /></TableCell>

                      {/* Market data — show source status */}
                      <TableCell className="font-mono text-xs text-right">
                        {row.marketDataStatus === "not_synced" ? (
                          <span className="text-slate-600">—</span>
                        ) : row.marketAvg != null ? (
                          <span className="text-slate-300">{row.marketAvg.toFixed(1)}</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right">
                        {row.marketDataStatus === "not_synced" ? (
                          <span className="text-slate-600 text-[10px]">no mkt data</span>
                        ) : row.trueEdge != null ? (
                          <span className={`font-bold ${row.trueEdge > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            <MarketStatusDot status={row.marketDataStatus} />
                            {row.trueEdge > 0 ? "+" : ""}{row.trueEdge.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-600 text-[10px]">no mkt data</span>
                        )}
                      </TableCell>

                      {/* Our projection */}
                      <TableCell className="text-right">
                        {row.ourProjection ? (
                          <span className="flex items-center justify-end gap-1">
                            <span className="font-mono text-xs text-violet-300">{row.ourProjection.value.toFixed(1)}</span>
                            <ConfidenceBadge confidence={row.ourProjection.confidence} />
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs font-mono">—</span>
                        )}
                      </TableCell>

                      {/* Streak */}
                      <TableCell className="text-right font-mono text-xs">
                        {row.streak && row.streak.count >= 2 ? (
                          <span className={`${row.streak.type === "over" ? "text-emerald-400" : "text-rose-400"}`}>
                            {row.streak.count}{row.streak.type === "over" ? "↑" : "↓"}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-center">
                        <ActionTagBadge tag={row.actionTag} />
                      </TableCell>
                    </TableRow>
                  ))
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
