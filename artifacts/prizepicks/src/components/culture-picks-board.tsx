import { useEntry } from "@/lib/entry-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Minus, TrendingUp, TrendingDown, Sparkles } from "lucide-react";

interface CultureRow {
  ppLineId: number;
  playerId: number;
  playerName: string;
  sport: string;
  statType: string;
  lineValue: number;
  lineType: string;
  pickCategory?: string;
}

interface Props {
  rows: CultureRow[];
  isLoading: boolean;
  onSelectProp: (id: number) => void;
}

function isYesNo(statType: string): boolean {
  const s = statType.toLowerCase();
  return s.includes("win") || s.includes("award") || s.includes("championship") || s.includes("named") || s.includes("drafted");
}

export function CulturePicksBoard({ rows, isLoading, onSelectProp }: Props) {
  const { addPick, removePick, hasPick } = useEntry();

  const sportGroups: Record<string, CultureRow[]> = {};
  for (const row of rows) {
    const key = row.sport;
    if (!sportGroups[key]) sportGroups[key] = [];
    sportGroups[key].push(row);
  }

  return (
    <div className="flex-1 overflow-auto min-h-0 space-y-4">
      <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-lg px-4 py-2 flex items-center gap-3">
        <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
        <p className="text-xs font-mono text-indigo-300">
          <span className="font-bold text-indigo-200">Culture &amp; Specials</span> — Award winners, box office results, season futures, and entertainment predictions. No model scoring — pick your gut.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-32 bg-slate-900 w-full rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm font-mono">
          No culture picks available — they appear around award seasons and special events.
        </div>
      ) : (
        Object.entries(sportGroups).map(([sport, sportRows]) => (
          <div key={sport} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 flex items-center gap-3">
              <span className="font-mono text-xs text-indigo-400 font-bold">{sport}</span>
              <span className="text-xs text-muted-foreground font-mono">{sportRows.length} pick{sportRows.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y divide-slate-800">
              {sportRows.map((row) => {
                const isPicked = hasPick(row.ppLineId);
                const yesNo = isYesNo(row.statType);
                return (
                  <div
                    key={row.ppLineId}
                    className="px-4 py-3 flex items-center gap-4 hover:bg-slate-800/30 transition-colors cursor-pointer"
                    onClick={() => onSelectProp(row.ppLineId)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">{row.playerName}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{row.statType}</div>
                    </div>
                    <div className="text-lg font-mono font-bold text-indigo-300 w-20 text-right shrink-0">
                      {yesNo ? "—" : String(row.lineValue)}
                    </div>
                    <div className="w-20 text-center shrink-0">
                      <CultureLineBadge type={row.lineType} />
                    </div>
                    <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {yesNo ? (
                        <Button
                          size="sm"
                          variant={isPicked ? "default" : "outline"}
                          className="font-mono text-xs h-7 px-3 border-indigo-800 text-indigo-400 hover:bg-indigo-900/30"
                          onClick={() => isPicked ? removePick(row.ppLineId) : addPick({
                            ppLineId: row.ppLineId, playerId: row.playerId, playerName: row.playerName,
                            imageUrl: null, teamAbbr: null, statType: row.statType, lineValue: row.lineValue,
                            lineType: row.lineType, direction: "more", yourProjection: null, p99: null, pOver: null, edgeScore: null, actionTag: null,
                          })}
                        >
                          {isPicked ? <Minus className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                          {isPicked ? "REMOVE" : "YES"}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant={isPicked ? "default" : "outline"}
                            className="font-mono text-xs h-7 px-2 border-emerald-800 text-emerald-400 hover:bg-emerald-900/30"
                            onClick={() => isPicked ? removePick(row.ppLineId) : addPick({
                              ppLineId: row.ppLineId, playerId: row.playerId, playerName: row.playerName,
                              imageUrl: null, teamAbbr: null, statType: row.statType, lineValue: row.lineValue,
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
                              ppLineId: row.ppLineId + 10000, playerId: row.playerId, playerName: row.playerName,
                              imageUrl: null, teamAbbr: null, statType: row.statType, lineValue: row.lineValue,
                              lineType: row.lineType, direction: "less", yourProjection: null, p99: null, pOver: null, edgeScore: null, actionTag: null,
                            })}
                          >
                            <TrendingDown className="w-3 h-3 mr-1" /> UNDER
                          </Button>
                        </>
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

function CultureLineBadge({ type }: { type: string }) {
  if (type === "demon") return <Badge className="bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-700/50 font-mono text-[10px]">demon</Badge>;
  if (type === "goblin") return <Badge className="bg-orange-900/50 text-orange-300 border border-orange-700/50 font-mono text-[10px]">goblin</Badge>;
  return <Badge className="bg-slate-800 text-slate-400 border-slate-700 font-mono text-[10px]">standard</Badge>;
}
