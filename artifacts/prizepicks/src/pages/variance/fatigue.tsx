import { Battery, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface FatiguePlayer {
  playerId: number;
  playerName: string;
  sport: string;
  fatigueScore: number;
  fatigueLabel: string | null;
  daysRest: number | null;
  isBackToBack: boolean | null;
  isThreeInFour: boolean | null;
  gamesLast7Days: number | null;
  prevGameMinutes: string | null;
  avgMinutesL5: string | null;
  travelMiles: number | null;
  timezoneShiftHours: number | null;
  prevGameHomeAway: string | null;
  warnings: string | null;
  computedAt: string | null;
}

interface FatigueResponse {
  date: string;
  players: FatiguePlayer[];
  computedAt: string | null;
  summary: {
    total: number;
    backToBack: number;
    threeInFour: number;
    heavyFatigue: number;
    wellRested: number;
  };
}

const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

function useFatigueData(sport?: string) {
  return useQuery<FatigueResponse>({
    queryKey: ["/api/fatigue/today", sport],
    queryFn: async () => {
      const url = sport
        ? `${base}/api/fatigue/today?sport=${sport}`
        : `${base}/api/fatigue/today`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Fatigue fetch failed");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

function FatigueMeter({ score, label }: { score: number; label: string | null }) {
  const color =
    score >= 60 ? "bg-rose-500" :
    score >= 40 ? "bg-amber-500" :
    score >= 20 ? "bg-yellow-500" :
    "bg-emerald-500";
  const textColor =
    score >= 60 ? "text-rose-400" :
    score >= 40 ? "text-amber-400" :
    score <= -5 ? "text-emerald-400" :
    "text-slate-300";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono">
        <span className="text-muted-foreground">Fatigue</span>
        <span className={`font-bold ${textColor}`}>{score}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.max(2, Math.abs(score))}%` }}
        />
      </div>
      {label && (
        <div className={`text-[9px] font-mono ${textColor} truncate`}>{label}</div>
      )}
    </div>
  );
}

function FatiguePlayerRow({ player }: { player: FatiguePlayer }) {
  const score    = player.fatigueScore ?? 0;
  const warnings = (player.warnings ?? "").split(",").filter(Boolean);

  return (
    <div className="flex items-center gap-3 p-3 bg-slate-950 border border-slate-800 rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{player.playerName}</div>
        <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5">
          {player.sport}
          {player.isBackToBack && (
            <span className="text-rose-400 font-bold">B2B</span>
          )}
          {player.isThreeInFour && (
            <span className="text-amber-400 font-bold">3in4</span>
          )}
          {warnings.includes("heavy_minutes") && (
            <span className="text-orange-400 font-bold">HVY</span>
          )}
        </div>
      </div>

      <div className="text-center shrink-0">
        <div className="text-xs font-mono font-bold">
          {player.daysRest === null ? "—" :
           player.daysRest === 0 ? "B2B" :
           player.daysRest === 1 ? "1d" :
           `${player.daysRest}d`}
        </div>
        <div className="text-[9px] text-muted-foreground">rest</div>
      </div>

      {player.prevGameMinutes && (
        <div className="text-center shrink-0">
          <div className="text-xs font-mono font-bold">
            {parseFloat(player.prevGameMinutes).toFixed(0)}m
          </div>
          <div className="text-[9px] text-muted-foreground">last</div>
        </div>
      )}

      {(player.travelMiles ?? 0) > 500 && (
        <div className="text-center shrink-0">
          <div className="text-xs font-mono text-amber-400 font-bold">
            {(player.travelMiles ?? 0).toLocaleString()}mi
          </div>
          <div className="text-[9px] text-muted-foreground">travel</div>
        </div>
      )}

      <div className="shrink-0 w-28">
        <FatigueMeter score={score} label={player.fatigueLabel} />
      </div>
    </div>
  );
}

function EmptyFatigueState({ onCompute }: { onCompute: () => void }) {
  return (
    <div className="py-16 text-center space-y-3">
      <Battery className="w-10 h-10 text-muted-foreground/30 mx-auto" />
      <div>
        <p className="text-sm font-mono font-semibold text-foreground">
          No fatigue data for today's slate
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Fatigue is computed from player game logs. Run Force Sync to pull
          schedule data and calculate rest scores.
        </p>
      </div>
      <Button size="sm" onClick={onCompute} className="font-mono text-xs gap-1.5">
        <RefreshCw className="w-3 h-3" /> Compute Fatigue Now
      </Button>
      <p className="text-[10px] text-slate-600 font-mono">
        Requires projection sync to have run first (populates game logs)
      </p>
    </div>
  );
}

export default function FatigueTracker() {
  const { data, isLoading, refetch } = useFatigueData();

  const players    = data?.players ?? [];
  const summary    = data?.summary;
  const highFatigue = players.filter(p => (p.fatigueScore ?? 0) >= 40);
  const rested     = players.filter(p => (p.daysRest ?? 0) >= 4);

  async function handleComputeNow() {
    await fetch(`${base}/api/sync/fatigue`, { method: "POST" });
    setTimeout(() => refetch(), 3000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Battery className="w-6 h-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Fatigue Tracker</h1>
          <p className="text-sm text-muted-foreground font-mono">
            Rest load modeling from schedule data
          </p>
        </div>
        {summary && (
          <div className="flex gap-4 text-center text-[11px] font-mono">
            <div>
              <div className="text-rose-400 font-bold">{summary.backToBack}</div>
              <div className="text-muted-foreground">B2B</div>
            </div>
            <div>
              <div className="text-amber-400 font-bold">{summary.threeInFour}</div>
              <div className="text-muted-foreground">3in4</div>
            </div>
            <div>
              <div className="text-emerald-400 font-bold">{summary.wellRested}</div>
              <div className="text-muted-foreground">rested</div>
            </div>
            <div>
              <div className="text-slate-300 font-bold">{summary.total}</div>
              <div className="text-muted-foreground">total</div>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-slate-800" />
          ))}
        </div>
      ) : players.length === 0 ? (
        <EmptyFatigueState onCompute={handleComputeNow} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-rose-400 flex items-center gap-2">
                <Battery className="w-4 h-4" /> High Fatigue Load
                <span className="ml-auto text-muted-foreground">{highFatigue.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {highFatigue.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono">No high-fatigue players</p>
              ) : highFatigue.slice(0, 12).map(p => (
                <FatiguePlayerRow key={p.playerId} player={p} />
              ))}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <Battery className="w-4 h-4" /> Well Rested — Advantage
                <span className="ml-auto text-muted-foreground">{rested.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rested.length === 0 ? (
                <p className="text-xs text-muted-foreground font-mono">No well-rested players identified</p>
              ) : rested.slice(0, 12).map(p => (
                <FatiguePlayerRow key={p.playerId} player={p} />
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
