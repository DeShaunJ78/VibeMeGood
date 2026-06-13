import { useState, useEffect } from "react";
import { RefreshCw, Radio, Circle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useGetLiveEntries, getGetLiveEntriesQueryKey } from "@workspace/api-client-react";
import type { LiveEntry, LiveLeg } from "@workspace/api-client-react";

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function GameScoreBadge({ leg }: { leg: LiveLeg }) {
  const gs = leg.gameScore;
  if (!gs) return <span className="text-muted-foreground text-xs font-mono">No game data</span>;

  const { homeTeam, awayTeam, homeScore, awayScore, commenceTime } = gs;
  const hasScores = homeScore != null && awayScore != null;
  const gameTime = formatTime(commenceTime);

  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      {leg.isLive && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
      )}
      {leg.isFinal && <CheckCircle2 className="w-3 h-3 text-slate-500 shrink-0" />}
      {!leg.isLive && !leg.isFinal && <Clock className="w-3 h-3 text-slate-600 shrink-0" />}
      <span className={cn("text-slate-400", leg.isLive && "text-emerald-400")}>
        {hasScores ? (
          <>{awayTeam.split(" ").pop()} {awayScore} – {homeScore} {homeTeam.split(" ").pop()}</>
        ) : (
          <>{awayTeam.split(" ").pop()} @ {homeTeam.split(" ").pop()} · {gameTime}</>
        )}
        {leg.isFinal && <span className="ml-1 text-slate-500">FINAL</span>}
        {leg.isLive && <span className="ml-1 text-emerald-500/80">LIVE</span>}
      </span>
    </div>
  );
}

function LegRow({ leg }: { leg: LiveLeg }) {
  const dir = leg.direction === "more" ? "↑" : "↓";
  const dirColor = leg.direction === "more" ? "text-emerald-400" : "text-red-400";
  const resultColor =
    leg.result === "hit"  ? "text-emerald-400" :
    leg.result === "miss" ? "text-rose-400" :
    leg.result === "dnp"  ? "text-slate-500" :
    "text-slate-400";

  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium text-sm text-foreground truncate">{leg.playerName}</span>
          <span className="text-muted-foreground text-xs font-mono truncate">{leg.statType}</span>
        </div>
        <GameScoreBadge leg={leg} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("font-mono text-sm font-bold", dirColor)}>{dir} {leg.lineValue}</span>
        {leg.result !== "pending" && (
          <span className={cn("font-mono text-xs font-bold uppercase", resultColor)}>
            {leg.result}
          </span>
        )}
        {leg.result === "pending" && leg.isFinal && (
          <span className="text-slate-500 font-mono text-[10px]">FINAL</span>
        )}
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: LiveEntry }) {
  const liveCount  = entry.legs.filter(l => l.isLive).length;
  const finalCount = entry.legs.filter(l => l.isFinal).length;
  const pendingCount = entry.legs.filter(l => !l.isLive && !l.isFinal && l.result === "pending").length;

  return (
    <div className={cn(
      "rounded-lg border bg-card p-4 space-y-3",
      entry.hasLiveGame
        ? "border-emerald-800/50 bg-emerald-950/10"
        : "border-border/50"
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {entry.hasLiveGame && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          )}
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {entry.entryType} · {entry.pickCount}-pick
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {liveCount > 0 && (
            <Badge className="bg-emerald-900/60 text-emerald-400 border-emerald-700/40 text-[10px] px-1.5 py-0 font-mono">
              {liveCount} live
            </Badge>
          )}
          {finalCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono text-slate-400">
              {finalCount} final
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono text-slate-500">
              {pendingCount} upcoming
            </Badge>
          )}
        </div>
      </div>

      <div className="divide-y divide-border/30">
        {entry.legs.map(leg => (
          <LegRow key={leg.pickId} leg={leg} />
        ))}
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <span className="font-mono text-xs text-muted-foreground">
          Stake: <span className="text-foreground">${entry.stake.toFixed(2)}</span>
        </span>
        {entry.potentialPayout != null && (
          <span className="font-mono text-xs text-muted-foreground">
            To win: <span className="text-emerald-400">${entry.potentialPayout.toFixed(2)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default function Live() {
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const { data, isFetching, refetch } = useGetLiveEntries({
    query: {
      queryKey: getGetLiveEntriesQueryKey(),
      refetchInterval: 60_000,
      staleTime: 55_000,
    },
  });

  useEffect(() => {
    if (!isFetching) setLastRefreshed(new Date());
  }, [isFetching]);

  const entries  = data?.entries ?? [];
  const hasAnyLive = data?.hasAnyLive ?? false;

  const liveEntries    = entries.filter(e => e.hasLiveGame);
  const upcomingEntries = entries.filter(e => !e.hasLiveGame);

  const ageMinutes = Math.floor((Date.now() - lastRefreshed.getTime()) / 60_000);
  const stale = ageMinutes >= 2;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/50 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-muted-foreground" />
          <div>
            <h1 className="font-bold text-lg leading-tight">Live Tracker</h1>
            <p className="text-xs text-muted-foreground font-mono">
              Today's open entries · real-time game context
            </p>
          </div>
          {hasAnyLive && (
            <span className="flex items-center gap-1.5 ml-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-emerald-400 text-xs font-mono font-bold">LIVE</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            "text-xs font-mono",
            stale ? "text-amber-400" : "text-muted-foreground"
          )}>
            {stale ? `${ageMinutes}m ago` : "Updated just now"}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs font-mono gap-1.5"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {entries.length === 0 && !isFetching && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
            <Circle className="w-10 h-10 text-slate-700" />
            <div>
              <p className="text-muted-foreground font-mono text-sm">No open entries today</p>
              <p className="text-slate-600 font-mono text-xs mt-1">
                Log an entry in Entry Builder to track it here.
              </p>
            </div>
          </div>
        )}

        {liveEntries.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              In Progress ({liveEntries.length})
            </h2>
            {liveEntries.map(e => <EntryCard key={e.entryId} entry={e} />)}
          </section>
        )}

        {upcomingEntries.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {liveEntries.length > 0 ? "Upcoming / No Data" : "Today's Entries"} ({upcomingEntries.length})
            </h2>
            {upcomingEntries.map(e => <EntryCard key={e.entryId} entry={e} />)}
          </section>
        )}

        <p className="text-center text-slate-600 text-[10px] font-mono pt-2">
          Game context via The Odds API · auto-refreshes every 60s · per-player live stats not available
        </p>
      </div>
    </div>
  );
}
