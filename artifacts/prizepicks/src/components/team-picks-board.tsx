import { useEntry } from "@/lib/entry-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Minus, TrendingUp, TrendingDown, Users } from "lucide-react";

interface TeamRow {
  ppLineId: number;
  playerId: number;
  playerName: string;
  teamAbbr?: string | null;
  opponentAbbr?: string | null;
  sport: string;
  startTime?: string | null;
  statType: string;
  lineValue: number;
  lineType: string;
  pickCategory?: string;
  teamPickType?: string | null;
  teamId?: number | null;
}

interface Props {
  rows: TeamRow[];
  isLoading: boolean;
  onSelectProp: (id: number) => void;
}

const PICK_TYPE_LABEL: Record<string, string> = {
  moneyline: "Moneyline",
  spread: "Spread Cover",
  total: "Team Total",
  future: "Future",
};

const PICK_TYPE_COLOR: Record<string, string> = {
  moneyline: "text-violet-400",
  spread: "text-amber-400",
  total: "text-sky-400",
  future: "text-emerald-400",
};

function formatLine(row: TeamRow) {
  if (row.teamPickType === "moneyline") return "Yes / No";
  if (row.teamPickType === "spread") return `${Number(row.lineValue) > 0 ? "+" : ""}${row.lineValue}`;
  return String(row.lineValue);
}

export function TeamPicksBoard({ rows, isLoading, onSelectProp }: Props) {
  const { addPick, removePick, hasPick } = useEntry();

  const gameGroups: Record<string, TeamRow[]> = {};
  for (const row of rows) {
    const key = row.opponentAbbr ? `${row.teamAbbr} vs ${row.opponentAbbr}` : (row.teamAbbr ?? "Unknown");
    if (!gameGroups[key]) gameGroups[key] = [];
    gameGroups[key].push(row);
  }

  return (
    <div className="flex-1 overflow-auto min-h-0 space-y-4">
      <div className="bg-violet-950/30 border border-violet-800/40 rounded-lg px-4 py-2 flex items-center gap-3">
        <Users className="w-4 h-4 text-violet-400 shrink-0" />
        <p className="text-xs font-mono text-violet-300">
          <span className="font-bold text-violet-200">Team Picks</span> — Pick outcomes on full-game team results (moneylines, spreads, totals). Powered by PrizePicks × Kalshi prediction markets. Launched Nov 2025.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-48 bg-slate-900 w-full rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm font-mono">
          No team picks available. Run seed to populate.
        </div>
      ) : (
        Object.entries(gameGroups).map(([gameKey, gameRows]) => (
          <div key={gameKey} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 flex items-center gap-3">
              <span className="font-mono text-xs text-primary font-bold">{gameRows[0]?.sport}</span>
              <span className="font-bold text-sm">{gameKey}</span>
              {gameRows[0]?.startTime && (
                <span className="text-xs text-muted-foreground font-mono ml-auto">
                  {new Date(gameRows[0].startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            <div className="divide-y divide-slate-800">
              {gameRows.map((row) => {
                const isPicked = hasPick(row.ppLineId);
                const typeColor = PICK_TYPE_COLOR[row.teamPickType ?? "total"] ?? "text-muted-foreground";
                return (
                  <div
                    key={row.ppLineId}
                    className="px-4 py-3 flex items-center gap-4 hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="w-28 shrink-0">
                      <span className={`text-xs font-mono font-bold ${typeColor}`}>
                        {PICK_TYPE_LABEL[row.teamPickType ?? "total"]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm">{row.teamAbbr}</div>
                      <div className="text-xs text-muted-foreground font-mono">{row.statType}</div>
                    </div>
                    <div className="text-lg font-mono font-bold text-primary w-20 text-right">
                      {formatLine(row)}
                    </div>
                    <div className="w-20 text-center">
                      <TeamLineBadge type={row.lineType} />
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {row.teamPickType !== "moneyline" ? (
                        <>
                          <Button
                            size="sm"
                            variant={isPicked ? "default" : "outline"}
                            className="font-mono text-xs h-7 px-2 border-emerald-800 text-emerald-400 hover:bg-emerald-900/30"
                            onClick={() => isPicked ? removePick(row.ppLineId) : addPick({
                              ppLineId: row.ppLineId, playerId: row.playerId, playerName: row.teamAbbr ?? "Team",
                              imageUrl: null, teamAbbr: row.teamAbbr ?? null, statType: row.statType, lineValue: row.lineValue,
                              lineType: row.lineType, direction: "more", yourProjection: null, p99: null, pOver: null, edgeScore: null, actionTag: null,
                            })}
                          >
                            <TrendingUp className="w-3 h-3 mr-1" /> OVER
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="font-mono text-xs h-7 px-2 border-rose-800 text-rose-400 hover:bg-rose-900/30"
                            onClick={() => addPick({
                              ppLineId: row.ppLineId + 10000, playerId: row.playerId, playerName: row.teamAbbr ?? "Team",
                              imageUrl: null, teamAbbr: row.teamAbbr ?? null, statType: row.statType, lineValue: row.lineValue,
                              lineType: row.lineType, direction: "less", yourProjection: null, p99: null, pOver: null, edgeScore: null, actionTag: null,
                            })}
                          >
                            <TrendingDown className="w-3 h-3 mr-1" /> UNDER
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant={isPicked ? "default" : "outline"}
                          className="font-mono text-xs h-7 px-3 border-violet-800 text-violet-400 hover:bg-violet-900/30"
                          onClick={() => isPicked ? removePick(row.ppLineId) : addPick({
                            ppLineId: row.ppLineId, playerId: row.playerId, playerName: row.teamAbbr ?? "Team",
                            imageUrl: null, teamAbbr: row.teamAbbr ?? null, statType: "Win", lineValue: row.lineValue,
                            lineType: row.lineType, direction: "more", yourProjection: null, p99: null, pOver: null, edgeScore: null, actionTag: null,
                          })}
                        >
                          {isPicked ? <Minus className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                          {isPicked ? "REMOVE" : "YES — WIN"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TeamLineBadge({ type }: { type: string }) {
  if (type === "demon") return <Badge className="bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-700/50 font-mono text-[10px]">demon</Badge>;
  if (type === "goblin") return <Badge className="bg-orange-900/50 text-orange-300 border border-orange-700/50 font-mono text-[10px]">goblin</Badge>;
  return <Badge className="bg-slate-800 text-slate-400 border-slate-700 font-mono text-[10px]">standard</Badge>;
}
