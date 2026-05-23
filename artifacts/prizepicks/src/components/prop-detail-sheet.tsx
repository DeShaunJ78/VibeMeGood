import { useState, useEffect, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineTypeBadge, ActionTagBadge } from "./ui/badges";
import { ScoreBar } from "./ui/score-bar";
import { useEntry } from "@/lib/entry-context";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from "recharts";
import { Plus, Minus, Zap, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Activity, Database, Wind, CloudRain, Shield } from "lucide-react";
import { VarianceBadge } from "@/components/ui/variance-badge";
import { useUserSettings } from "@/hooks/use-user-settings";

interface PropDetailSheetProps {
  ppLineId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface OurProjection {
  value: number;
  stdDev: number | null;
  pOver: number | null;
  percentileAtLine: number | null;
  dataQualityScore: number | null;
  shrinkageFactor: number | null;
  noPlayReason: string | null;
  sourceLabel: string | null;
  confidence: string | null;
  gamesUsed: number | null;
  isStale: boolean;
  reasoning: Record<string, unknown> | null;
}

interface PropDetail {
  ppLine: any;
  player: any;
  game: any;
  lineHistory: any[];
  projection: any | null;
  ourProjection: OurProjection | null;
  recentGames: { date: string; value: number }[];
  externalLines: any[];
  propScore: any | null;
  injuries: any[];
  lineupConfirmation: any | null;
  isWatched: boolean;
}

function pOverColor(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 60) return "text-emerald-400";
  if (pct >= 54) return "text-lime-400";
  if (pct >= 50) return "text-yellow-400";
  if (pct >= 42) return "text-orange-400";
  return "text-rose-400";
}

function confidenceBadgeClass(conf: string | null): string {
  switch (conf) {
    case "high":      return "bg-emerald-900/50 text-emerald-300 border-emerald-700/50";
    case "medium":    return "bg-indigo-900/50 text-indigo-300 border-indigo-700/50";
    case "low":       return "bg-amber-900/50 text-amber-300 border-amber-700/50";
    case "very_low":  return "bg-rose-900/50 text-rose-300 border-rose-700/50";
    default:          return "bg-slate-800 text-slate-400 border-slate-700";
  }
}

type VarianceData = {
  volatilityRating: string | null;
  blowoutRisk: number | null;
  fatigueScore: number | null;
  usageScore: number | null;
  matchupScore: number | null;
  evModifier: string | null;
  warnings: string[] | null;
  whyItMoves: string | null;
};

function WhyThisEdgePanel({ variance }: { variance: VarianceData }) {
  const SIGNAL_LABELS: Record<string, { label: string; emoji: string; getColor: (v: number) => string }> = {
    fatigue: {
      label: "Fatigue",
      emoji: "🔋",
      getColor: v => v >= 60 ? "text-rose-400" : v >= 35 ? "text-amber-400" : "text-emerald-400",
    },
    blowout: {
      label: "Blowout Risk",
      emoji: "💥",
      getColor: v => v >= 40 ? "text-rose-400" : v >= 25 ? "text-amber-400" : "text-emerald-400",
    },
    usage: {
      label: "Usage Score",
      emoji: "📈",
      getColor: v => v >= 70 ? "text-violet-400" : v >= 45 ? "text-slate-300" : "text-orange-400",
    },
    matchup: {
      label: "Matchup",
      emoji: "⚔️",
      getColor: v => v >= 65 ? "text-emerald-400" : v >= 45 ? "text-slate-300" : "text-rose-400",
    },
  };

  const scores = [
    { key: "fatigue",  value: variance.fatigueScore },
    { key: "blowout",  value: variance.blowoutRisk },
    { key: "usage",    value: variance.usageScore },
    { key: "matchup",  value: variance.matchupScore },
  ].filter(s => s.value != null) as { key: string; value: number }[];

  const evMod = variance.evModifier ? parseFloat(variance.evModifier) : 0;

  return (
    <div className="px-5 py-4 border-b border-slate-800/50">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
        <Shield className="w-3 h-3" /> Why This Edge Exists
        <VarianceBadge rating={variance.volatilityRating} size="xs" className="ml-auto" />
      </div>

      {variance.whyItMoves && (
        <p className="text-xs text-slate-300 mb-3 leading-relaxed">{variance.whyItMoves}</p>
      )}

      {scores.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {scores.map(({ key, value }) => {
            const cfg = SIGNAL_LABELS[key];
            if (!cfg) return null;
            return (
              <div key={key} className="bg-slate-900 border border-slate-800 rounded px-2.5 py-2">
                <div className="text-[10px] text-muted-foreground font-mono">{cfg.emoji} {cfg.label}</div>
                <div className={`text-sm font-mono font-bold mt-0.5 ${cfg.getColor(value)}`}>{value}/100</div>
                <div className="h-1 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${cfg.getColor(value).replace("text-", "bg-")}`}
                    style={{ width: `${Math.max(2, value)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {Math.abs(evMod) >= 0.01 && (
        <div className={`text-[11px] font-mono flex items-center gap-1.5 ${evMod > 0 ? "text-emerald-400" : "text-rose-400"}`}>
          <TrendingUp className="w-3 h-3" />
          EV modifier: {evMod > 0 ? "+" : ""}{(evMod * 100).toFixed(0)}% (capped ±15%)
        </div>
      )}

      {variance.warnings && variance.warnings.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {variance.warnings.map(w => (
            <span key={w} className="text-[10px] font-mono bg-rose-900/30 text-rose-300 border border-rose-700/30 px-1.5 py-0.5 rounded">
              ⚠ {w.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PropDetailSheet({ ppLineId, open, onOpenChange }: PropDetailSheetProps) {
  const [data, setData] = useState<PropDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [explainText, setExplainText] = useState<string>("");
  const [explaining, setExplaining] = useState(false);
  const [direction, setDirection] = useState<"more" | "less">("more");
  const [variance, setVariance] = useState<VarianceData | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { addPick, removePick, hasPick, updateDirection } = useEntry();
  const { data: userSettings } = useUserSettings();

  useEffect(() => {
    if (!ppLineId || !open) return;
    setData(null);
    setExplainText("");
    setLoading(true);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    setVariance(null);
    fetch(`${base}/api/slate/${ppLineId}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
        return fetch(`${base}/api/variance/${ppLineId}`);
      })
      .then(r => r?.ok ? r.json() : null)
      .then(v => { if (v) setVariance(v); })
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
        yourProjection: data.ourProjection?.value ?? (data.projection ? Number(data.projection.projectedValue) : null),
        pOver: data.ourProjection?.pOver ?? null,
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

  // Prefer our projection value for gap display
  const projValue = data?.ourProjection?.value ?? (data?.projection ? Number(data.projection.projectedValue) : null);
  const gap = projValue != null ? projValue - lineValue : null;

  const historyChartData = data?.lineHistory.map((h: any) => ({
    time: new Date(h.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: Number(h.lineValue),
  })) ?? [];

  const recentGamesData = (data?.recentGames ?? []).map((g, i) => ({
    label: `G${i + 1}`,
    value: g.value,
  }));

  const op = data?.ourProjection ?? null;
  const pOver = op?.pOver ?? null;

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
                  <SheetDescription className="flex items-center gap-2 mt-1 font-mono text-xs flex-wrap">
                    <span className="text-muted-foreground">{data.player.sport} · {data.player.position}</span>
                    {data.game && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span className="text-primary">{new Date(data.game.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </>
                    )}
                    {data.game?.metadata?.weather?.isOutdoor && (
                      <span className="flex items-center gap-1 bg-sky-900/50 border border-sky-700/40 text-sky-300 px-1.5 py-0.5 rounded text-[9px]">
                        <Wind className="w-2.5 h-2.5" />
                        {data.game.metadata.weather.windSpeed} mph {data.game.metadata.weather.windDir}
                        {" · "}{data.game.metadata.weather.temp}°F
                      </span>
                    )}
                    {data.game?.metadata?.homePitcher && (
                      <span className="text-slate-400 text-[9px]">SP: {data.game.metadata.homePitcher}</span>
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
              {/* The Line + Our Projection */}
              <div className="p-5 grid grid-cols-2 gap-3 border-b border-slate-800/50">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-center">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">PP Line</div>
                  <div className="text-4xl font-bold font-mono">{lineValue}</div>
                  <div className="text-xs text-slate-400 mt-1 font-mono">{data.ppLine.statType}</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-center">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Our Projection</div>
                  <div className={`text-4xl font-bold font-mono ${gap != null && gap > 0 ? "text-emerald-400" : gap != null && gap < 0 ? "text-rose-400" : "text-primary"}`}>
                    {projValue?.toFixed(1) ?? "—"}
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

              {/* ── Model Distribution Panel ── */}
              {op && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-3 h-3 text-indigo-400" />
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Model Distribution</div>
                    {op.confidence && (
                      <Badge className={`text-[9px] font-mono ml-auto px-1.5 py-0 h-4 ${confidenceBadgeClass(op.confidence)}`}>
                        {op.confidence.replace("_", " ").toUpperCase()}
                      </Badge>
                    )}
                  </div>

                  {/* P(Over) + Std Dev */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="col-span-2 bg-slate-900 border border-slate-800 p-3 rounded-lg text-center">
                      <div className="text-[10px] font-mono text-muted-foreground mb-0.5">P(OVER LINE)</div>
                      <div className={`text-3xl font-bold font-mono ${pOverColor(pOver)}`}>
                        {pOver != null ? `${pOver.toFixed(1)}%` : "—"}
                      </div>
                      {op.percentileAtLine != null && (
                        <div className="text-[9px] font-mono text-muted-foreground mt-1">
                          line at {op.percentileAtLine.toFixed(0)}th pct
                        </div>
                      )}
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center">
                      <div className="text-[10px] font-mono text-muted-foreground mb-0.5">σ / STD</div>
                      <div className="text-2xl font-bold font-mono text-slate-300">
                        {op.stdDev != null ? `±${op.stdDev.toFixed(1)}` : "—"}
                      </div>
                      <div className="text-[9px] font-mono text-muted-foreground mt-1">spread</div>
                    </div>
                  </div>

                  {/* Data Quality bar */}
                  {op.dataQualityScore != null && (
                    <div className="mb-3">
                      <ScoreBar label="Data Quality" value={op.dataQualityScore} colorClass="bg-indigo-500" />
                    </div>
                  )}

                  {/* Meta info row */}
                  <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground flex-wrap">
                    <div className="flex items-center gap-1">
                      <Database className="w-2.5 h-2.5" />
                      <span>{op.sourceLabel ?? "prior_only"}</span>
                      {op.gamesUsed != null && <span className="text-slate-600">({op.gamesUsed}g)</span>}
                    </div>
                    {op.shrinkageFactor != null && (
                      <span className="text-slate-600">shrink {(op.shrinkageFactor * 100).toFixed(0)}%→prior</span>
                    )}
                    {op.isStale && <span className="text-amber-400">stale</span>}
                  </div>

                  {/* No-play gate warning */}
                  {op.noPlayReason && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono text-amber-400 bg-amber-950/30 border border-amber-800/40 px-2 py-1.5 rounded">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>NO-PLAY: {op.noPlayReason.replace(/_/g, " ")}</span>
                    </div>
                  )}

                  {/* Reasoning blob */}
                  {op.reasoning && typeof op.reasoning === "object" && (
                    <div className="mt-2 text-[9px] font-mono text-slate-500 space-y-0.5">
                      {Object.entries(op.reasoning as Record<string, unknown>).map(([k, v]) =>
                        typeof v === "string" ? (
                          <div key={k}>· {v}</div>
                        ) : Array.isArray(v) && v.length > 0 ? (
                          v.map((s, i) => <div key={`${k}-${i}`}>· {String(s)}</div>)
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Recent Games Bar Chart ── */}
              {recentGamesData.length > 0 && (
                <div className="px-5 py-4 border-b border-slate-800/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">
                    Last {recentGamesData.length} Games vs {lineValue} Line
                  </div>
                  <div className="h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={recentGamesData} margin={{ top: 4, right: 4, left: -22, bottom: 2 }}>
                        <XAxis dataKey="label" fontSize={9} stroke="#475569" tickLine={false} axisLine={false} />
                        <YAxis fontSize={10} stroke="#475569" tickLine={false} axisLine={false} domain={[0, "auto"]} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", fontFamily: "monospace", fontSize: 11 }}
                          formatter={(val: number) => [val.toFixed(1), data.ppLine.statType]}
                        />
                        <ReferenceLine y={lineValue} stroke="#0ea5e9" strokeDasharray="4 2" strokeWidth={1.5} />
                        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                          {recentGamesData.map((entry, i) => (
                            <Cell key={i} fill={entry.value > lineValue ? "#10b981" : "#f43f5e"} fillOpacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-1">
                    <span className="text-slate-600">← older</span>
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" /> over
                      <span className="inline-block w-2 h-2 rounded-sm bg-rose-500/70" /> under
                    </span>
                    <span className="text-slate-600">recent →</span>
                  </div>
                </div>
              )}

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

              {/* Variance Intelligence — Why This Edge Exists */}
              {userSettings?.varianceIntelEnabled && variance && (
                <WhyThisEdgePanel variance={variance} />
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
