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

export default function Streaks() {
  const { data: streaks, isLoading } = useStreaks();
  const { addPick } = useEntry();
  const { toast } = useToast();

  const maxStreak = streaks ? Math.max(...streaks.map(s => s.streakLength), 1) : 1;

  const overStreaks  = streaks?.filter(s => s.streakType === "over")  ?? [];
  const underStreaks = streaks?.filter(s => s.streakType === "under") ?? [];

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
      pOver:          null,
      edgeScore:      null,
      actionTag:      null,
    });
    toast({ title: "Pick added", description: `${s.playerName} ${s.statType} added to Entry Builder.` });
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold font-mono text-foreground">Streak Tracker</h1>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">
          Players on consecutive OVER or UNDER runs. Streaks update as you log pick results.
        </p>
      </div>

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
