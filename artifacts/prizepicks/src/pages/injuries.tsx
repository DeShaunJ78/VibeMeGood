import { useState, useEffect, useCallback } from "react";
import { useListInjuries, getListInjuriesQueryKey, useListLineupConfirmations, getListLineupConfirmationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Clock, Activity, CheckCircle2, PlusCircle, LayoutList, Flame, TrendingUp, TrendingDown, Zap, Target } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface HotStreak {
  playerName: string;
  sport: string;
  statType: string;
  streakType: string | null;
  streakLength: number;
}

interface LineMove {
  playerName: string;
  sport: string;
  statType: string;
  prevLine: string | null;
  newLine: string | null;
  moveSize: string | null;
  moveDirection: string | null;
  sharpSignal: string | null;
  sharpExplanation: string | null;
  capturedAt: string | null;
}

interface PropSignal {
  playerName: string;
  sport: string;
  statType: string;
  lineValue: string | null;
  lineType: string | null;
  pOver: string | null;
  edgeScore: string | null;
  overallScore: string | null;
  recommendedSide: string | null;
}

interface IntelFeed {
  hotStreaks: HotStreak[];
  lineMoves: LineMove[];
  topPlays: PropSignal[];
  topFades: PropSignal[];
}

export default function Injuries() {
  const [sport, setSport] = useState<string>("all");
  const [slateOnly, setSlateOnly] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ playerName: "", playerTeam: "", sport: "NBA", status: "Questionable", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const [intel, setIntel] = useState<IntelFeed | null>(null);
  const [intelLoading, setIntelLoading] = useState(true);
  const qc = useQueryClient();

  const fetchIntel = useCallback(async () => {
    try {
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const res = await fetch(`${base}/api/intel-feed`);
      if (res.ok) setIntel(await res.json() as IntelFeed);
    } catch { /* non-fatal */ }
    setIntelLoading(false);
  }, []);

  useEffect(() => { void fetchIntel(); }, [fetchIntel]);

  async function handleAddInjury(e: React.FormEvent) {
    e.preventDefault();
    if (!form.playerName.trim()) return;
    setSubmitting(true);
    try {
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      await fetch(`${base}/api/injuries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, reportedAt: new Date().toISOString(), source: "manual" }),
      });
      await qc.invalidateQueries({ queryKey: getListInjuriesQueryKey() });
      setForm({ playerName: "", playerTeam: "", sport: "NBA", status: "Questionable", note: "" });
      setAddOpen(false);
    } catch { /* non-fatal */ }
    setSubmitting(false);
  }

  const injuryParams = {
    ...(sport !== "all" ? { sport } : {}),
    ...(slateOnly ? { slateOnly: true as const } : {}),
  };
  const hasParams = Object.keys(injuryParams).length > 0;
  const queryParams = hasParams ? injuryParams : undefined;

  const { data: injuries, isLoading: loadingInjuries } = useListInjuries(
    queryParams,
    { query: { queryKey: getListInjuriesQueryKey(queryParams) } }
  );

  const { data: lineups, isLoading: loadingLineups } = useListLineupConfirmations(
    undefined,
    { query: { queryKey: getListLineupConfirmationsQueryKey() } }
  );

  return (
    <>
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Injuries & Intel Feed</h1>
        <div className="flex items-center gap-3">
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> Updated just now
          </div>
          <button
            onClick={() => setSlateOnly(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
              slateOnly
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-slate-900 border-slate-700 text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutList className="w-3 h-3" />
            {slateOnly ? "Slate relevant" : "Showing all"}
          </button>
          <Select value={sport} onValueChange={setSport}>
            <SelectTrigger className="w-32 bg-slate-900 border-slate-800 font-mono text-sm">
              <SelectValue placeholder="Sport" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              <SelectItem value="NBA">NBA</SelectItem>
              <SelectItem value="NFL">NFL</SelectItem>
              <SelectItem value="MLB">MLB</SelectItem>
              <SelectItem value="NHL">NHL</SelectItem>
              <SelectItem value="WNBA">WNBA</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 overflow-hidden">
        {/* Left: Injury Reports */}
        <div className="flex flex-col overflow-hidden bg-slate-900 border border-slate-800 rounded-lg">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-500" />
            <h2 className="font-bold">Injury Reports</h2>
            {injuries && injuries.length > 0 && (
              <span className="ml-auto text-xs font-mono text-muted-foreground">{injuries.length} report{injuries.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {loadingInjuries ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800 w-full" />)
            ) : injuries?.length === 0 ? (
              <div className="text-center py-12 space-y-3 px-4">
                <Activity className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                {slateOnly ? (
                  <>
                    <div className="text-sm font-medium text-muted-foreground">No slate-relevant injuries</div>
                    <div className="text-xs text-muted-foreground/70 max-w-sm mx-auto leading-relaxed">
                      No injury flags for players on today's active lines. You can{" "}
                      <button onClick={() => setSlateOnly(false)} className="text-primary underline underline-offset-2">show all reports</button>{" "}
                      or add a manual note below.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium text-muted-foreground">No injury data yet</div>
                    <div className="text-xs text-muted-foreground/70 max-w-sm mx-auto leading-relaxed">
                      Automated injury sync requires a connected feed. You can manually add injury notes below.
                    </div>
                  </>
                )}
                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1.5 font-mono text-xs border-slate-700 mt-2">
                  <PlusCircle className="w-3.5 h-3.5" /> Add Manual Injury Note
                </Button>
              </div>
            ) : (
              injuries?.map((injury) => (
                <Card key={injury.id} className="bg-slate-950 border-slate-800 overflow-hidden">
                  <div className={`h-1 w-full ${injury.status.toLowerCase().includes('out') ? 'bg-rose-500' : 'bg-amber-500'}`} />
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-bold text-lg">{injury.playerName}</div>
                        <div className="text-xs font-mono text-muted-foreground">{injury.playerTeam} • {injury.sport}</div>
                      </div>
                      <Badge variant="outline" className={injury.status.toLowerCase().includes('out') ? 'text-rose-400 border-rose-400/30' : 'text-amber-400 border-amber-400/30'}>
                        {injury.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-300 mt-2">{injury.note}</p>
                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-800/50 text-[10px] font-mono text-muted-foreground">
                      <span>Source: {injury.source}</span>
                      <span>{formatDistanceToNow(new Date(injury.reportedAt), { addSuffix: true })}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <div className="p-3 border-t border-slate-800">
            <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} className="gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground w-full">
              <PlusCircle className="w-3.5 h-3.5" /> Add Manual Note
            </Button>
          </div>
        </div>

        {/* Right: Intel Feed */}
        <div className="flex flex-col overflow-hidden bg-slate-900 border border-slate-800 rounded-lg">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h2 className="font-bold">Intel Feed</h2>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Live signals</span>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-5">
            {intelLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 bg-slate-800 w-full" />)
            ) : (
              <>
                {/* Hot Streaks */}
                <IntelSection
                  icon={<Flame className="w-3.5 h-3.5 text-orange-400" />}
                  label="Hot Streaks"
                  labelColor="text-orange-400"
                  count={intel?.hotStreaks.length ?? 0}
                  emptyText="No streaks ≥3 games tracked yet"
                >
                  {intel?.hotStreaks.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
                      <div>
                        <span className="text-sm font-medium">{s.playerName}</span>
                        <span className="text-xs text-muted-foreground font-mono ml-2">{s.sport} · {s.statType}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={s.streakType === "over" ? "text-emerald-400 border-emerald-400/30 text-[10px]" : "text-rose-400 border-rose-400/30 text-[10px]"}>
                          {s.streakType?.toUpperCase()} ×{s.streakLength}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </IntelSection>

                {/* Line Moves */}
                <IntelSection
                  icon={<TrendingUp className="w-3.5 h-3.5 text-sky-400" />}
                  label="Line Moves"
                  labelColor="text-sky-400"
                  count={intel?.lineMoves.length ?? 0}
                  emptyText="No significant line moves in last 24h"
                >
                  {intel?.lineMoves.map((m, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
                      <div className="min-w-0">
                        <span className="text-sm font-medium">{m.playerName}</span>
                        <span className="text-xs text-muted-foreground font-mono ml-2">{m.statType}</span>
                        {m.sharpExplanation && (
                          <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{m.sharpExplanation}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs font-mono text-muted-foreground">{m.prevLine} → {m.newLine}</span>
                        {m.sharpSignal && m.sharpSignal !== "neutral" && (
                          <Badge variant="outline" className="text-amber-400 border-amber-400/30 text-[10px]">
                            ⚡ {m.sharpSignal.toUpperCase()}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </IntelSection>

                {/* Model Plays */}
                <IntelSection
                  icon={<Target className="w-3.5 h-3.5 text-emerald-400" />}
                  label="Model Plays"
                  labelColor="text-emerald-400"
                  count={intel?.topPlays.length ?? 0}
                  emptyText="No PLAY props scored yet — import PP lines to see model picks"
                >
                  {intel?.topPlays.map((p, i) => (
                    <PropRow key={i} prop={p} variant="play" />
                  ))}
                </IntelSection>

                {/* Model Fades */}
                <IntelSection
                  icon={<TrendingDown className="w-3.5 h-3.5 text-rose-400" />}
                  label="Model Fades"
                  labelColor="text-rose-400"
                  count={intel?.topFades.length ?? 0}
                  emptyText="No NO-PLAY props scored yet"
                >
                  {intel?.topFades.map((p, i) => (
                    <PropRow key={i} prop={p} variant="fade" />
                  ))}
                </IntelSection>

                {/* Lineup Confirmations */}
                <IntelSection
                  icon={<CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />}
                  label="Lineup Confirmations"
                  labelColor="text-violet-400"
                  count={lineups?.length ?? 0}
                  emptyText="No lineup confirmations yet"
                >
                  {loadingLineups ? (
                    <Skeleton className="h-12 bg-slate-800 w-full" />
                  ) : (
                    lineups?.map((lineup) => (
                      <div key={lineup.id} className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
                        <div>
                          <span className="text-sm font-medium">{lineup.playerName}</span>
                          {lineup.expectedMinutes && (
                            <span className="text-xs font-mono text-primary ml-2">{lineup.expectedMinutes} min</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className={lineup.isStarting ? 'text-emerald-400 border-emerald-400/30 text-[10px]' : 'text-slate-400 border-slate-600 text-[10px]'}>
                            {lineup.isStarting ? 'STARTING' : 'BENCH'}
                          </Badge>
                          <span className="text-[10px] font-mono text-muted-foreground">{formatDistanceToNow(new Date(lineup.confirmedAt), { addSuffix: true })}</span>
                        </div>
                      </div>
                    ))
                  )}
                </IntelSection>
              </>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Manual injury entry dialog */}
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Add Manual Injury Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleAddInjury} className="space-y-3 mt-2">
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Player Name *</Label>
            <Input
              value={form.playerName}
              onChange={e => setForm(f => ({ ...f, playerName: e.target.value }))}
              placeholder="e.g. LeBron James"
              className="bg-slate-950 border-slate-700 font-mono text-sm mt-1"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Team</Label>
              <Input
                value={form.playerTeam}
                onChange={e => setForm(f => ({ ...f, playerTeam: e.target.value }))}
                placeholder="e.g. LAL"
                className="bg-slate-950 border-slate-700 font-mono text-sm mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Sport</Label>
              <Select value={form.sport} onValueChange={v => setForm(f => ({ ...f, sport: v }))}>
                <SelectTrigger className="bg-slate-950 border-slate-700 font-mono text-sm mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NBA">NBA</SelectItem>
                  <SelectItem value="NFL">NFL</SelectItem>
                  <SelectItem value="MLB">MLB</SelectItem>
                  <SelectItem value="NHL">NHL</SelectItem>
                  <SelectItem value="WNBA">WNBA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Status</Label>
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger className="bg-slate-950 border-slate-700 font-mono text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Out">Out</SelectItem>
                <SelectItem value="Doubtful">Doubtful</SelectItem>
                <SelectItem value="Questionable">Questionable</SelectItem>
                <SelectItem value="GTD">Game-Time Decision</SelectItem>
                <SelectItem value="Probable">Probable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground">Note</Label>
            <Input
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="e.g. Knee soreness, limited practice"
              className="bg-slate-950 border-slate-700 font-mono text-sm mt-1"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen(false)} className="font-mono text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting} className="font-mono text-xs">
              {submitting ? "Saving…" : "Save Injury Note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

function IntelSection({
  icon,
  label,
  labelColor,
  count,
  emptyText,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  labelColor: string;
  count: number;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className={`text-xs font-mono font-bold uppercase tracking-wider ${labelColor}`}>{label}</span>
        {count > 0 && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground">{count}</span>
        )}
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded px-3 py-1">
        {count === 0 ? (
          <div className="text-xs text-muted-foreground/60 py-2 text-center">{emptyText}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function PropRow({ prop, variant }: { prop: PropSignal; variant: "play" | "fade" }) {
  const pOver = prop.pOver != null ? Math.round(Number(prop.pOver) * 10) / 10 : null;
  const side = prop.recommendedSide?.toUpperCase() ?? "?";
  const edge = prop.edgeScore != null ? Math.round(Number(prop.edgeScore)) : null;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
      <div className="min-w-0">
        <span className="text-sm font-medium">{prop.playerName}</span>
        <span className="text-xs text-muted-foreground font-mono ml-2">{prop.statType} {prop.lineValue}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        {pOver != null && (
          <span className={`text-xs font-mono ${variant === "play" ? "text-emerald-400" : "text-rose-400"}`}>
            {side} {pOver}%
          </span>
        )}
        {edge != null && (
          <span className="text-[10px] font-mono text-muted-foreground">E:{edge}</span>
        )}
      </div>
    </div>
  );
}
