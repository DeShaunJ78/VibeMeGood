import { useState, useEffect, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineTypeBadge, ActionTagBadge } from "./ui/badges";
import { ScoreBar } from "./ui/score-bar";
import { useEntry } from "@/lib/entry-context";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Plus, Minus, Zap, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from "lucide-react";

interface PropDetailSheetProps {
  ppLineId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PropDetail {
  ppLine: any;
  player: any;
  game: any;
  lineHistory: any[];
  projection: any | null;
  externalLines: any[];
  propScore: any | null;
  injuries: any[];
  lineupConfirmation: any | null;
  isWatched: boolean;
}

export function PropDetailSheet({ ppLineId, open, onOpenChange }: PropDetailSheetProps) {
  const [data, setData] = useState<PropDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [explainText, setExplainText] = useState<string>("");
  const [explaining, setExplaining] = useState(false);
  const [direction, setDirection] = useState<"more" | "less">("more");
  const abortRef = useRef<AbortController | null>(null);
  const { addPick, removePick, hasPick, updateDirection } = useEntry();

  useEffect(() => {
    if (!ppLineId || !open) return;
    setData(null);
    setExplainText("");
    setLoading(true);
    fetch(`/api/slate/${ppLineId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ppLineId, open]);

  const isPicked = ppLineId ? hasPick(ppLineId) : false;

  function handleAddRemove() {
    if (!ppLineId || !data) return;
    if (isPicked) {
      removePick(ppLineId);
    } else {
      addPick({
        ppLineId,
        playerId: data.player.id,
        playerName: data.player.fullName,
        teamAbbr: null,
        statType: data.ppLine.statType,
        lineValue: Number(data.ppLine.lineValue),
        lineType: data.ppLine.lineType,
        direction,
        yourProjection: data.projection ? Number(data.projection.projectedValue) : null,
        edgeScore: data.propScore ? Number(data.propScore.edgeScore) : null,
        actionTag: data.propScore?.actionTag ?? null,
      });
    }
  }

  async function handleExplain() {
    if (!ppLineId) return;
    setExplainText("");
    setExplaining(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/explain/prop/${ppLineId}`, {
        method: "POST",
        signal: abortRef.current.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.text) setExplainText(prev => prev + payload.text);
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setExplainText("Analysis failed. Please try again.");
    } finally {
      setExplaining(false);
    }
  }

  const lineValue = data ? Number(data.ppLine.lineValue) : 0;
  const projection = data?.projection ? Number(data.projection.projectedValue) : null;
  const gap = projection != null ? projection - lineValue : null;

  const historyChartData = data?.lineHistory.map((h: any) => ({
    time: new Date(h.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: Number(h.lineValue),
  })) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg border-l-slate-800 bg-slate-950 p-0 flex flex-col gap-0 overflow-hidden">
        {!ppLineId ? null : loading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-1/2 bg-slate-800" />
            <Skeleton className="h-4 w-1/3 bg-slate-800" />
            <Skeleton className="h-32 w-full bg-slate-800" />
            <Skeleton className="h-32 w-full bg-slate-800" />
          </div>
        ) : data ? (
          <>
            {/* Header */}
            <SheetHeader className="p-5 pb-4 border-b border-slate-800 bg-slate-900/50 shrink-0">
              <div className="flex items-start justify-between">
                <div>
                  <SheetTitle className="text-xl font-bold">{data.player.fullName}</SheetTitle>
                  <SheetDescription className="flex items-center gap-2 mt-1 font-mono text-xs">
                    <span className="text-muted-foreground">{data.player.sport} · {data.player.position}</span>
                    {data.game && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span className="text-primary">{new Date(data.game.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </>
                    )}
                  </SheetDescription>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {data.propScore && <ActionTagBadge tag={data.propScore.actionTag} />}
                  <LineTypeBadge type={data.ppLine.lineType} />
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto">
              {/* The Line + Projection */}
              <div className="p-5 grid grid-cols-2 gap-3 border-b border-slate-800/50">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-center">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">PP Line</div>
                  <div className="text-4xl font-bold font-mono">{lineValue}</div>
                  <div className="text-xs text-slate-400 mt-1 font-mono">{data.ppLine.statType}</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-center">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Our Projection</div>
                  <div className={`text-4xl font-bold font-mono ${gap != null && gap > 0 ? "text-emerald-400" : gap != null && gap < 0 ? "text-rose-400" : "text-primary"}`}>
                    {projection?.toFixed(1) ?? "—"}
                  </div>
                  <div className={`text-xs font-mono mt-1 ${gap != null && gap > 0 ? "text-emerald-400" : gap != null && gap < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                    {gap != null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)} gap` : "No projection"}
                  </div>
                </div>
              </div>

              {/* Direction + Add to Entry */}
              <div className="px-5 py-4 border-b border-slate-800/50 flex items-center gap-3">
                <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex-1">
                  <button
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-mono font-bold transition-colors ${direction === "more" ? "bg-emerald-900/50 text-emerald-300" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => { setDirection("more"); if (isPicked && ppLineId) updateDirection(ppLineId, "more"); }}
                  >
                    <TrendingUp className="w-3.5 h-3.5" /> MORE
                  </button>
                  <button
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-mono font-bold transition-colors ${direction === "less" ? "bg-rose-900/50 text-rose-300" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => { setDirection("less"); if (isPicked && ppLineId) updateDirection(ppLineId, "less"); }}
                  >
                    <TrendingDown className="w-3.5 h-3.5" /> LESS
                  </button>
                </div>
                <Button
                  onClick={handleAddRemove}
                  className={`font-mono text-xs shrink-0 ${isPicked ? "bg-rose-900/50 text-rose-300 border-rose-800 hover:bg-rose-900" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                  variant={isPicked ? "outline" : "default"}
                >
                  {isPicked ? <><Minus className="w-3.5 h-3.5 mr-1" /> REMOVE</> : <><Plus className="w-3.5 h-3.5 mr-1" /> ADD TO ENTRY</>}
                </Button>
              </div>

              {/* Score Breakdown */}
              {data.propScore && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">Score Breakdown</div>
                  <div className="space-y-3">
                    <ScoreBar label="Edge Score" value={Number(data.propScore.edgeScore)} colorClass="bg-primary" />
                    <ScoreBar label="Stability" value={Number(data.propScore.stabilityScore)} colorClass="bg-emerald-500" />
                    <ScoreBar label="Market Support" value={Number(data.propScore.marketSupportScore)} colorClass="bg-indigo-500" />
                    <ScoreBar label="Risk Score" value={Number(data.propScore.riskScore)} colorClass="bg-rose-500" />
                  </div>
                  {data.propScore.reasoning && (
                    <div className="mt-3 text-xs text-muted-foreground font-mono bg-slate-900 border border-slate-800 p-3 rounded space-y-1">
                      {Object.values(data.propScore.reasoning as Record<string, string>).map((note, i) => (
                        <div key={i} className="text-slate-400">• {note}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Line History Chart */}
              {historyChartData.length > 1 && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">Line Movement</div>
                  <div className="h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historyChartData} margin={{ top: 2, right: 4, left: -20, bottom: 2 }}>
                        <XAxis dataKey="time" fontSize={10} stroke="#475569" tickLine={false} axisLine={false} />
                        <YAxis fontSize={10} stroke="#475569" tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", fontFamily: "monospace", fontSize: 11 }} />
                        <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} dot={{ fill: "#0ea5e9", r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Projection Range */}
              {data.projection && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">Projection Range</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "Floor", value: data.projection.floorValue, color: "text-rose-400" },
                      { label: "Median", value: data.projection.medianValue, color: "text-primary" },
                      { label: "Ceiling", value: data.projection.ceilingValue, color: "text-emerald-400" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-slate-900 border border-slate-800 p-2 rounded">
                        <div className="text-[10px] font-mono text-muted-foreground">{label}</div>
                        <div className={`text-lg font-bold font-mono ${color}`}>{Number(value).toFixed(1)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-muted-foreground text-right">
                    Confidence: {(Number(data.projection.confidenceScore) * 100).toFixed(0)}% · Source: {data.projection.projectionSource}
                  </div>
                </div>
              )}

              {/* External Lines */}
              {data.externalLines.length > 0 && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">Book Comparison</div>
                  <div className="space-y-2">
                    {data.externalLines.map((el: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm bg-slate-900 border border-slate-800 px-3 py-2 rounded">
                        <span className="font-mono text-xs font-bold text-slate-300">{el.bookName}</span>
                        <div className="flex items-center gap-4 font-mono text-xs">
                          <span className="text-emerald-400">O {el.overLine}</span>
                          <span className="text-rose-400">U {el.underLine}</span>
                          {el.noVigOverProb && (
                            <span className="text-muted-foreground">{(Number(el.noVigOverProb) * 100).toFixed(1)}% / {(Number(el.noVigUnderProb) * 100).toFixed(1)}%</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Injury Status */}
              {data.injuries.length > 0 && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">Injury Status</div>
                  {data.injuries.map((inj: any, i: number) => {
                    const isHealthy = inj.status === "healthy" || inj.status === "active";
                    return (
                      <div key={i} className={`flex items-start gap-2 text-xs p-3 rounded border ${isHealthy ? "bg-emerald-950/30 border-emerald-800/40" : "bg-amber-950/30 border-amber-700/40"}`}>
                        {isHealthy
                          ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                          : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />}
                        <div>
                          <span className={`font-bold font-mono ${isHealthy ? "text-emerald-300" : "text-amber-300"}`}>{inj.status.toUpperCase()}</span>
                          <span className="text-muted-foreground ml-2">{inj.note}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Lineup Confirmation */}
              {data.lineupConfirmation && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">Lineup Status</div>
                  <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-3 py-2 rounded text-xs font-mono">
                    <Badge className="bg-emerald-900/50 text-emerald-300 border-emerald-700/50">
                      {data.lineupConfirmation.isStarting ? "STARTING" : "BENCH"}
                    </Badge>
                    {data.lineupConfirmation.expectedMinutes && (
                      <span className="text-muted-foreground">Exp. mins: <span className="text-primary">{Number(data.lineupConfirmation.expectedMinutes).toFixed(1)}</span></span>
                    )}
                    {data.lineupConfirmation.minutesFloor && data.lineupConfirmation.minutesCeiling && (
                      <span className="text-muted-foreground">({Number(data.lineupConfirmation.minutesFloor).toFixed(0)}–{Number(data.lineupConfirmation.minutesCeiling).toFixed(0)} range)</span>
                    )}
                  </div>
                </div>
              )}

              {/* AI Explain */}
              <div className="px-5 py-4">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">AI Analysis</div>
                <Button
                  onClick={handleExplain}
                  disabled={explaining}
                  className="w-full font-mono text-xs bg-slate-800 border border-slate-700 hover:bg-slate-700 text-foreground mb-3"
                  variant="outline"
                >
                  <Zap className="w-3.5 h-3.5 mr-2 text-amber-400" />
                  {explaining ? "Analyzing..." : "Explain This Prop (Claude)"}
                </Button>
                {(explainText || explaining) && (
                  <div className="bg-slate-900 border border-slate-800 rounded p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {explainText || <span className="text-muted-foreground animate-pulse">▋</span>}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-muted-foreground">Prop not found</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
