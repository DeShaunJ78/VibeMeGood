import { useQuery } from "@tanstack/react-query";
import { Swords, ChevronDown, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

interface MatchupEntry {
  histId: number;
  opponentTeamId: number;
  gamesPlayed: number;
  avgValue: string | null;
  overRateAtCurrentLine: string | null;
  updatedAt: string;
  opponentName: string;
  opponentAbbr: string;
}

interface PlayerMatchup {
  playerId: number;
  playerName: string;
  team: string;
  sport: string;
  statType: string;
  lineValue: string;
  lineType: string;
  matchups: MatchupEntry[];
}

function useMatchup() {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  return useQuery<PlayerMatchup[]>({
    queryKey: ["matchup"],
    queryFn: () => fetch(`${base}/api/matchup`).then(r => r.json()),
    staleTime: 120_000,
  });
}

function OverRateBadge({ rate }: { rate: string | null }) {
  if (!rate) return <span className="text-muted-foreground">—</span>;
  const n = parseFloat(rate);
  const color = n >= 0.6 ? "text-emerald-400" : n <= 0.4 ? "text-red-400" : "text-slate-300";
  return <span className={`font-mono font-semibold ${color}`}>{Math.round(n * 100)}%</span>;
}

function PlayerRow({ p }: { p: PlayerMatchup }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3 text-left">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
          <div>
            <span className="font-mono text-sm font-semibold text-foreground">{p.playerName}</span>
            <span className="text-xs text-muted-foreground font-mono ml-2">{p.team} · {p.sport}</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground">{p.statType}</div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground font-mono">Today's Line</div>
            <div className="text-sm font-mono font-semibold text-primary">{parseFloat(p.lineValue).toFixed(1)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground font-mono">Matchups</div>
            <div className="text-sm font-mono font-semibold text-foreground">{p.matchups.length}</div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800">
          {p.matchups.length === 0 ? (
            <div className="px-4 py-4 text-xs font-mono text-muted-foreground text-center">
              No matchup history yet — this populates as you log results over time.
            </div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800/60 text-muted-foreground">
                  <th className="text-left px-4 py-2">Opponent</th>
                  <th className="text-right px-4 py-2">Games</th>
                  <th className="text-right px-4 py-2">Avg Value</th>
                  <th className="text-right px-4 py-2">Over Rate vs Line</th>
                </tr>
              </thead>
              <tbody>
                {p.matchups.map(m => (
                  <tr key={m.histId} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                    <td className="px-4 py-2 text-foreground">
                      {m.opponentAbbr}
                      {m.opponentName && m.opponentName !== m.opponentAbbr && (
                        <span className="text-muted-foreground ml-1">({m.opponentName})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{m.gamesPlayed}</td>
                    <td className="px-4 py-2 text-right">
                      {m.avgValue ? parseFloat(m.avgValue).toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <OverRateBadge rate={m.overRateAtCurrentLine} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function Matchup() {
  const { data, isLoading } = useMatchup();
  const [search, setSearch] = useState("");

  const filtered = (data ?? []).filter(p =>
    !search || p.playerName.toLowerCase().includes(search.toLowerCase()) || p.statType.toLowerCase().includes(search.toLowerCase())
  );

  const withHistory    = filtered.filter(p => p.matchups.length > 0);
  const withoutHistory = filtered.filter(p => p.matchups.length === 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono text-foreground">Matchup Analysis</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            Head-to-head history per player vs. tonight's opponent — populated as you log results.
          </p>
        </div>
        <input
          type="text"
          placeholder="Search player..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 w-48"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 bg-slate-800 rounded" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-slate-800 rounded-lg bg-slate-900/50">
          <Swords className="w-10 h-10 text-slate-600 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">No active slate</p>
          <p className="font-mono text-xs text-slate-600 mt-1 max-w-xs">
            Sync the PrizePicks lines in Settings to load today's props.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {withHistory.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                With Matchup History ({withHistory.length})
              </div>
              {withHistory.map(p => <PlayerRow key={`${p.playerId}-${p.statType}`} p={p} />)}
            </div>
          )}
          {withoutHistory.length > 0 && (
            <div className="space-y-2 mt-4">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                No History Yet ({withoutHistory.length})
              </div>
              {withoutHistory.map(p => <PlayerRow key={`${p.playerId}-${p.statType}`} p={p} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
