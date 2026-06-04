import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Zap, PlusCircle } from "lucide-react";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntry } from "@/lib/entry-context";
import { useToast } from "@/hooks/use-toast";

interface Streak {
  streakId: number;
  playerId: number;
  playerName: string;
  imageUrl: string | null;
  teamAbbr: string | null;
  sport: string;
  statType: string;
  currentStreak: number;
  streakType: string | null;
  streakLength: number;
  todaysLine: string | null;
  updatedAt: string;
}

function useStreaks() {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  return useQuery<Streak[]>({
    queryKey: ["streaks"],
    queryFn: () => fetch(`${base}/api/streaks`).then(r => r.json()),
    staleTime: 60_000,
  });
}

function StreakBar({ length, max }: { length: number; max: number }) {
  const pct = max > 0 ? (length / max) * 100 : 0;
  return (
    <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const MIN_STREAK_OPTIONS = [1, 2, 3, 5] as const;

export default function Streaks() {
  const { data: streaks, isLoading } = useStreaks();
  const { addPick } = useEntry();
  const { toast } = useToast();

  const [sportFilter, setSportFilter] = useState<string>("all");
  const [minStreak, setMinStreak] = useState<number>(1);

  const sports: string[] = streaks
    ? ["all", ...Array.from(new Set(streaks.map(s => s.sport))).sort()]
    : ["all"];

  const visible = streaks?.filter(s =>
    (sportFilter === "all" || s.sport === sportFilter) &&
    s.streakLength >= minStreak,
  ) ?? [];

  const maxStreak = visible.length > 0
    ? Math.max(...visible.map(s => s.streakLength), 1)
    : 1;

  const overStreaks  = visible.filter(s => s.streakType === "over");
  const underStreaks = visible.filter(s => s.streakType === "under");

  function handleAdd(s: Streak) {
    if (!s.todaysLine) {
      toast({ title: "No active line", description: `${s.playerName} has no line on today's slate.`, variant: "destructive" });
      return;
    }
    addPick({
      ppLineId:       0,
      playerId:       s.playerId,
      playerName:     s.playerName,
      imageUrl:       s.imageUrl ?? null,
      teamAbbr:       s.teamAbbr,
      statType:       s.statType,
      lineValue:      parseFloat(s.todaysLine),
      lineType:       "standard",
      direction:      s.streakType === "over" ? "more" : "less",
      yourProjection: null,
      p99:            null,
      pOver:          null,
      edgeScore:      null,
      actionTag:      null,
    });
    toast({ title: "Pick added", description: `${s.playerName} ${s.statType} added to Entry Builder.` });
  }

  const totalCount = streaks?.length ?? 0;
  const filteredCount = visible.length;
  const isFiltered = sportFilter !== "all" || minStreak > 1;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold font-mono text-foreground">Streak Tracker</h1>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">
          Players on consecutive OVER or UNDER runs. Streaks update as you log pick results.
        </p>
      </div>

      {/* Filters */}
      {!isLoading && streaks && streaks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Sport pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {sports.map(s => (
              <button
                key={s}
                onClick={() => setSportFilter(s)}
                className={[
                  "px-2.5 py-1 rounded text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors",
                  sportFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-slate-800 text-muted-foreground hover:bg-slate-700 hover:text-foreground",
                ].join(" ")}
              >
                {s === "all" ? "All Sports" : s}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-slate-700 hidden sm:block" />

          {/* Min streak threshold */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Min streak</span>
            {MIN_STREAK_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setMinStreak(n)}
                className={[
                  "w-7 h-6 rounded text-[11px] font-mono font-semibold transition-colors",
                  minStreak === n
                    ? "bg-slate-600 text-foreground"
                    : "bg-slate-800 text-muted-foreground hover:bg-slate-700 hover:text-foreground",
                ].join(" ")}
              >
                {n}+
              </button>
            ))}
          </div>

          {/* Row count */}
          {isFiltered && (
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">
              {filteredCount} / {totalCount} streaks
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 bg-slate-800 rounded" />)}
        </div>
      ) : !streaks || streaks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-slate-800 rounded-lg bg-slate-900/50">
          <Zap className="w-10 h-10 text-slate-600 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">No streaks yet</p>
          <p className="font-mono text-xs text-slate-600 mt-1 max-w-xs">
            Streaks build as you log pick results in the Journal. Grade your picks to start seeing patterns.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-slate-800 rounded-lg bg-slate-900/50">
          <Zap className="w-8 h-8 text-slate-600 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">No streaks match your filters</p>
          <button
            onClick={() => { setSportFilter("all"); setMinStreak(1); }}
            className="mt-2 text-xs font-mono text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* OVER Streaks */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 uppercase tracking-wider">
              <TrendingUp className="w-3.5 h-3.5" />
              Over Streaks ({overStreaks.length})
            </div>
            {overStreaks.length === 0 ? (
              <p className="text-xs text-slate-600 font-mono py-4 text-center">No active over streaks</p>
            ) : (
              overStreaks.map(s => (
                <div
                  key={s.streakId}
                  className="bg-slate-900 border border-slate-800 hover:border-emerald-800/50 rounded-lg px-4 py-3 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <PlayerAvatar name={s.playerName} imageUrl={s.imageUrl} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground truncate">
                            {s.playerName}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {s.teamAbbr} · {s.sport}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-muted-foreground font-mono">{s.statType}</span>
                          {s.todaysLine && (
                            <span className="text-xs font-mono text-primary">Line: {s.todaysLine}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="text-right">
                        <div className="text-xl font-bold font-mono text-emerald-400">
                          {s.streakLength}
                        </div>
                        <StreakBar length={s.streakLength} max={maxStreak} />
                      </div>
                      {s.todaysLine && (
                        <button
                          onClick={() => handleAdd(s)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                          title="Add to Entry Builder"
                        >
                          <PlusCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* UNDER Streaks */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono text-red-400 uppercase tracking-wider">
              <TrendingDown className="w-3.5 h-3.5" />
              Under Streaks ({underStreaks.length})
            </div>
            {underStreaks.length === 0 ? (
              <p className="text-xs text-slate-600 font-mono py-4 text-center">No active under streaks</p>
            ) : (
              underStreaks.map(s => (
                <div
                  key={s.streakId}
                  className="bg-slate-900 border border-slate-800 hover:border-red-800/50 rounded-lg px-4 py-3 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <PlayerAvatar name={s.playerName} imageUrl={s.imageUrl} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground truncate">
                            {s.playerName}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {s.teamAbbr} · {s.sport}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-muted-foreground font-mono">{s.statType}</span>
                          {s.todaysLine && (
                            <span className="text-xs font-mono text-primary">Line: {s.todaysLine}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="text-right">
                        <div className="text-xl font-bold font-mono text-red-400">
                          {s.streakLength}
                        </div>
                        <StreakBar length={s.streakLength} max={maxStreak} />
                      </div>
                      {s.todaysLine && (
                        <button
                          onClick={() => handleAdd(s)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                          title="Add to Entry Builder"
                        >
                          <PlusCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
