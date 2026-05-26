import { useState, useCallback, useEffect, useMemo } from "react";
import { useCreateEntry } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntry } from "@/lib/entry-context";
import { Target, Save, Zap, TrendingUp, TrendingDown, X, Flame, Smile, Cpu, ArrowUp, ArrowDown, ShieldAlert, AlertTriangle, ClipboardCheck, BarChart2 } from "lucide-react";
import { Link } from "wouter";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import {
  getBreakEven,
  getOptimalEntryType,
  pickemEV,
  detectPayoutShift,
  type EntryLeg,
} from "@workspace/analytics";

import type { EntryPick } from "@/lib/entry-context";

// Real PrizePicks payout multipliers
const POWER_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };
const FLEX_PAYOUTS: Record<number, Record<string, number>> = {
  2: { "2/2": 3 },
  3: { "3/3": 5, "2/3": 1.25 },
  4: { "4/4": 10, "3/4": 2.5 },
  5: { "5/5": 20, "4/5": 4, "3/5": 1 },
  6: { "6/6": 40, "5/6": 6, "4/6": 1.5 },
};

// ── EV computation helpers ──────────────────────────────────────────────────

function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? name : `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function legPHit(pick: EntryPick): number | null {
  if (pick.pOver == null) return null;
  return pick.direction === "more" ? pick.pOver / 100 : 1 - pick.pOver / 100;
}

interface EVResult {
  pWin: number;
  ev: number;
  evPct: number;
  hasAllData: boolean;
  legData: Array<{ name: string; statType: string; direction: "more" | "less"; pHit: number | null }>;
}

function computeEV(
  picks: EntryPick[],
  playstyle: "power" | "flex",
  payout: number,
  stake: number,
  flexPayouts: Record<string, number>,
): EVResult | null {
  if (picks.length < 2 || stake <= 0) return null;

  const legData = picks.map(p => ({
    name: abbreviateName(p.playerName),
    statType: p.statType,
    direction: p.direction,
    pHit: legPHit(p),
  }));

  const hasAllData = legData.every(l => l.pHit !== null);

  if (playstyle === "power") {
    const pWin = legData.reduce((acc, l) => acc * (l.pHit ?? 0.5), 1);
    const ev = pWin * payout - stake;
    return { pWin, ev, evPct: (ev / stake) * 100, hasAllData, legData };
  }

  // FLEX: exact per-combination DP
  const n = picks.length;
  let dp = new Array(n + 1).fill(0) as number[];
  dp[0] = 1;
  for (let i = 0; i < n; i++) {
    const p = legData[i].pHit ?? 0.5;
    const next = new Array(n + 1).fill(0) as number[];
    for (let k = 0; k <= i; k++) {
      next[k] += dp[k] * (1 - p);
      next[k + 1] += dp[k] * p;
    }
    dp = next;
  }
  let ev = -stake;
  let pWin = 0;
  for (let k = 0; k <= n; k++) {
    const mult = flexPayouts[`${k}/${n}`] ?? 0;
    if (mult > 0) { ev += dp[k] * mult * stake; pWin += dp[k]; }
  }
  return { pWin, ev, evPct: (ev / stake) * 100, hasAllData, legData };
}

interface LossLimitState {
  exceeded: boolean;
  totalLoss: number;
  limit: number;
}

type SortDir = "asc" | "desc";

export default function EntryBuilder() {
  const { toast } = useToast();
  const [stake, setStake] = useState<string>("25");
  const [playstyle, setPlaystyle] = useState<"power" | "flex">("power");
  const [notes, setNotes] = useState<string>("");
  const [pickSortCol, setPickSortCol] = useState<string>("pOver");
  const [pickSortDir, setPickSortDir] = useState<SortDir>("desc");
  const { picks, removePick, updateDirection, clearPicks } = useEntry();

  function togglePickSort(col: string) {
    if (pickSortCol === col) {
      setPickSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setPickSortCol(col);
      setPickSortDir("desc");
    }
  }
  const createEntry = useCreateEntry();
  const [lossLimitDialog, setLossLimitDialog] = useState<LossLimitState | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    fetch(`${base}/api/entries?result=pending`)
      .then(r => r.json())
      .then(data => setPendingCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, []);

  const stakeNum = parseFloat(stake) || 0;
  const n = picks.length;

  const sortedPicks = useMemo(() => {
    return [...picks].sort((a, b) => {
      let cmp = 0;
      switch (pickSortCol) {
        case "pOver": {
          const pA = legPHit(a) ?? -1;
          const pB = legPHit(b) ?? -1;
          cmp = pA - pB;
          break;
        }
        case "playerName":
          cmp = a.playerName.localeCompare(b.playerName);
          break;
        case "projGap": {
          const ga = a.yourProjection != null ? a.yourProjection - a.lineValue : -999;
          const gb = b.yourProjection != null ? b.yourProjection - b.lineValue : -999;
          cmp = ga - gb;
          break;
        }
        default: cmp = 0;
      }
      return pickSortDir === "asc" ? cmp : -cmp;
    });
  }, [picks, pickSortCol, pickSortDir]);

  // Detect same-team picks (correlation risk)
  const teamGroups = picks.reduce<Record<string, EntryPick[]>>((acc, p) => {
    if (!p.teamAbbr) return acc;
    acc[p.teamAbbr] = [...(acc[p.teamAbbr] ?? []), p];
    return acc;
  }, {});
  const correlatedTeams = Object.entries(teamGroups).filter(([, ps]) => ps.length >= 2);
  const multiplier = playstyle === "power" ? (POWER_MULTIPLIERS[n] ?? 0) : 0;
  const powerPayout = playstyle === "power" ? stakeNum * multiplier : 0;
  const flexPayouts = playstyle === "flex" && n >= 2 ? FLEX_PAYOUTS[n] ?? {} : {};
  const evResultPower = playstyle === "power" && n >= 2
    ? computeEV(picks, "power", powerPayout, stakeNum, {})
    : null;
  const evResultFlex = playstyle === "flex" && n >= 2
    ? computeEV(picks, "flex", 0, stakeNum, flexPayouts)
    : null;
  const activeEV = playstyle === "power" ? evResultPower : evResultFlex;

  // ── Pick'em Math (Enhancement 1 + 3) ──────────────────────────────────────
  const entryTypeKey = `${n}-pick-${playstyle}`;
  const breakEven     = n >= 2 ? getBreakEven(entryTypeKey) : null;
  const optimalKey    = n >= 2 ? getOptimalEntryType(n) : null;
  const isOptimal     = optimalKey === null || optimalKey === entryTypeKey;

  const legs: EntryLeg[] = picks.map(p => ({
    playerName: p.playerName,
    teamAbbr:   p.teamAbbr,
    statType:   p.statType,
    direction:  p.direction,
    pHit:       legPHit(p) ?? undefined,
  }));

  const shiftResult = n >= 2 && playstyle === "power" && multiplier > 0
    ? detectPayoutShift(legs, multiplier)
    : null;

  const adjustedEvPct = shiftResult?.hasShift && activeEV
    ? pickemEV(
        activeEV.legData.map(l => l.pHit ?? 0.5),
        shiftResult.estimatedMultiplier,
      ) * 100
    : null;

  const evPct       = activeEV?.evPct ?? null;
  // Indicator thresholds: green >5%, amber -0.5% to 5% (covers break-even), red <-0.5%
  const evDotColor  = evPct == null ? "bg-slate-700" :
    evPct > 5    ? "bg-emerald-500" :
    evPct >= -0.5 ? "bg-amber-400"  : "bg-rose-500";
  const evTextColor = evPct == null ? "text-slate-500" :
    evPct > 5    ? "text-emerald-400" :
    evPct >= -0.5 ? "text-amber-400"  : "text-rose-400";

  const doSave = useCallback(async () => {
    try {
      await createEntry.mutateAsync({
        data: {
          entryDate: new Date().toISOString().split("T")[0],
          entryType: playstyle,
          pickCount: picks.length,
          stake: stakeNum,
          displayedPayoutMultiplier: multiplier || null,
          potentialPayout: powerPayout || null,
          notes: notes || null,
        },
      });
      toast({ title: "Entry logged", description: `${picks.length}-pick ${playstyle} — $${stakeNum} stake saved to journal.` });
      clearPicks();
      setNotes("");
    } catch {
      toast({ title: "Failed to save", description: "Could not log entry.", variant: "destructive" });
    }
  }, [createEntry, playstyle, picks.length, stakeNum, multiplier, powerPayout, notes, toast, clearPicks]);

  async function handleSave() {
    if (picks.length < 2) {
      toast({ title: "Need more picks", description: "Minimum 2 picks required.", variant: "destructive" });
      return;
    }
    // Pre-flight: check daily loss limit
    try {
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const res = await fetch(`${base}/api/entries/loss-limit-status`);
      if (res.ok) {
        const status = await res.json() as LossLimitState;
        if (status.exceeded) {
          setLossLimitDialog(status);
          return;
        }
      }
    } catch { /* network error — proceed */ }
    await doSave();
  }

  return (
    <>
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Entry Builder</h1>
        <div className="flex gap-2">
          {picks.length > 0 && (
            <Button variant="outline" onClick={clearPicks} className="text-xs font-mono border-slate-700 text-muted-foreground">
              Clear All
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={createEntry.isPending || picks.length < 2}
            className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Save className="w-4 h-4 mr-2" /> LOG ENTRY
          </Button>
        </div>
      </div>

      {/* ── Pick'em Math Panel ─────────────────────────────────────────────── */}
      {n >= 2 && (
        <div className="shrink-0 space-y-2">
          {/* Main stat bar */}
          <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 flex-wrap">
            <BarChart2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="font-mono text-xs font-bold text-slate-200 uppercase tracking-wider shrink-0">
              {n}-pick {playstyle}
            </span>
            {multiplier > 0 && (
              <span className="font-mono text-xs text-slate-500 shrink-0">{multiplier}×</span>
            )}

            <div className="h-3 border-l border-slate-700 mx-1 shrink-0" />

            {/* Break-even */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-mono text-slate-500 uppercase">Break-even</span>
              <span className="font-mono text-xs font-bold text-primary">
                {breakEven != null ? `${(breakEven * 100).toFixed(1)}%` : "—"} per leg
              </span>
              {breakEven != null && (
                <span className="text-[10px] font-mono text-slate-500">
                  (each leg must hit above {(breakEven * 100).toFixed(1)}% to be +EV)
                </span>
              )}
            </div>

            <div className="h-3 border-l border-slate-700 mx-1 shrink-0" />

            {/* EV indicator */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className={`w-2 h-2 rounded-full shrink-0 ${evDotColor}`} />
              <span className="text-[10px] font-mono text-slate-500 uppercase">Entry EV</span>
              <span className={`font-mono text-xs font-bold ${evTextColor}`}>
                {evPct != null ? `${evPct >= 0 ? "+" : ""}${evPct.toFixed(1)}%` : "—"}
              </span>
              {adjustedEvPct != null && (
                <span className="text-[10px] font-mono text-slate-500">
                  · adj. <span className={adjustedEvPct >= 0 ? "text-amber-500" : "text-rose-500"}>
                    {adjustedEvPct >= 0 ? "+" : ""}{adjustedEvPct.toFixed(1)}%
                  </span>
                </span>
              )}
            </div>

            {/* Recommendation if suboptimal */}
            {!isOptimal && optimalKey && (
              <>
                <div className="h-3 border-l border-slate-700 mx-1 shrink-0" />
                <span className="text-[10px] font-mono text-amber-400/80 shrink-0">
                  Rec: {optimalKey} is optimal for {n} legs ({(getBreakEven(optimalKey) * 100).toFixed(1)}% break-even per leg)
                </span>
              </>
            )}
            {isOptimal && optimalKey && (
              <>
                <div className="h-3 border-l border-slate-700 mx-1 shrink-0" />
                <span className="text-[10px] font-mono text-emerald-500/70 shrink-0">
                  {optimalKey} is optimal for {n} legs ({(getBreakEven(optimalKey) * 100).toFixed(1)}% break-even per leg)
                </span>
              </>
            )}
          </div>

          {/* Payout shift warning */}
          {shiftResult?.hasShift && (
            <div className="bg-amber-950/40 border border-amber-700/50 rounded-lg px-4 py-2.5 space-y-1.5">
              <div className="flex items-start gap-2 text-xs font-mono text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                <div className="space-y-1">
                  <div className="font-bold leading-snug">{shiftResult.warning}</div>
                  {evPct != null && adjustedEvPct != null && (
                    <div className="flex items-center gap-3 text-[11px] text-amber-400/80 mt-1">
                      <span>Standard EV: <span className={evPct >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{evPct >= 0 ? "+" : ""}{evPct.toFixed(1)}%</span></span>
                      <span className="text-amber-700">→</span>
                      <span>Adjusted EV: <span className={adjustedEvPct >= 0 ? "text-amber-400 font-bold" : "text-rose-400 font-bold"}>{adjustedEvPct >= 0 ? "+" : ""}{adjustedEvPct.toFixed(1)}%</span></span>
                    </div>
                  )}
                  {shiftResult.tip && (
                    <div className="text-[10px] text-amber-500/60 pt-0.5">{shiftResult.tip}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-5 min-h-0">
        {/* Left: Pick List */}
        <div className="lg:col-span-2 flex flex-col bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-slate-800 bg-slate-950 font-bold flex items-center gap-2 text-sm shrink-0">
            <Target className="w-4 h-4 text-primary" />
            Active Picks ({picks.length}/6)
            {picks.length > 1 && (
              <div className="ml-auto flex items-center gap-1">
                <span className="text-[10px] font-mono font-normal text-slate-500">Sort:</span>
                {([["pOver","Hit%"],["playerName","Name"],["projGap","Gap"]] as const).map(([col, lbl]) => (
                  <button
                    key={col}
                    onClick={() => togglePickSort(col)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-normal transition-colors ${
                      pickSortCol === col
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "text-muted-foreground hover:text-foreground border border-transparent"
                    }`}
                  >
                    {lbl}{pickSortCol === col ? (pickSortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {picks.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center space-y-3 p-8">
                <div>
                  <div className="bg-slate-800/50 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Target className="w-7 h-7 text-slate-600" />
                  </div>
                  <p className="text-muted-foreground text-sm">No picks selected.</p>
                  <p className="text-xs font-mono text-slate-500 mt-1">Click a row on the Slate Board → Add to Entry</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {correlatedTeams.length > 0 && (
                  <div className="mx-3 mt-3 mb-1 flex items-start gap-2 bg-amber-950/40 border border-amber-700/50 rounded-lg px-3 py-2.5 text-xs font-mono text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <span className="font-bold">Teammate correlation risk</span>
                      {correlatedTeams.map(([team, ps]) => (
                        <div key={team} className="text-amber-400/80 mt-0.5">
                          {ps.length} {team} picks — shared possessions reduce leg independence
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {sortedPicks.map((pick) => (
                  <div key={pick.ppLineId} className="px-4 py-3 flex items-center gap-3">
                    <PlayerAvatar name={pick.playerName} imageUrl={pick.imageUrl} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">{pick.playerName}</div>
                      <div className="text-xs font-mono text-muted-foreground">{pick.statType} · {pick.lineValue}</div>
                    </div>
                    <LineTypePill type={pick.lineType} />
                    <div className="flex bg-slate-800 border border-slate-700 rounded overflow-hidden shrink-0">
                      <button
                        className={`flex items-center gap-1 px-2 py-1 text-[11px] font-mono font-bold transition-colors ${pick.direction === "more" ? "bg-emerald-900/60 text-emerald-300" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => updateDirection(pick.ppLineId, "more")}
                      >
                        <TrendingUp className="w-3 h-3" /> MORE
                      </button>
                      <button
                        className={`flex items-center gap-1 px-2 py-1 text-[11px] font-mono font-bold transition-colors ${pick.direction === "less" ? "bg-rose-900/60 text-rose-300" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => updateDirection(pick.ppLineId, "less")}
                      >
                        <TrendingDown className="w-3 h-3" /> LESS
                      </button>
                    </div>
                    {pick.edgeScore != null && (
                      <span className="text-xs font-mono text-primary font-bold w-10 text-right shrink-0">{pick.edgeScore.toFixed(0)}</span>
                    )}
                    <button onClick={() => removePick(pick.ppLineId)} className="text-slate-600 hover:text-rose-400 transition-colors shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Config + Math */}
        <div className="flex flex-col gap-4">
          {/* Playstyle Selector */}
          <Card className="bg-slate-900 border-slate-800 shrink-0">
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">Playstyle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPlaystyle("power")}
                  className={`p-3 rounded-lg border text-center transition-all ${playstyle === "power" ? "border-primary bg-primary/10 text-primary" : "border-slate-700 text-muted-foreground hover:border-slate-600"}`}
                >
                  <Flame className="w-5 h-5 mx-auto mb-1" />
                  <div className="text-xs font-mono font-bold">POWER</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">All must hit</div>
                </button>
                <button
                  onClick={() => setPlaystyle("flex")}
                  className={`p-3 rounded-lg border text-center transition-all ${playstyle === "flex" ? "border-emerald-500 bg-emerald-950/30 text-emerald-400" : "border-slate-700 text-muted-foreground hover:border-slate-600"}`}
                >
                  <Smile className="w-5 h-5 mx-auto mb-1" />
                  <div className="text-xs font-mono font-bold">FLEX</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">1–2 misses ok</div>
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground uppercase">Stake ($)</label>
                <Input
                  type="number"
                  value={stake}
                  onChange={e => setStake(e.target.value)}
                  className="bg-slate-950 border-slate-800 font-mono text-lg h-10"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground uppercase">Notes</label>
                <Input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional context..."
                  className="bg-slate-950 border-slate-800 font-mono text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {/* Payout Math */}
          <Card className="bg-slate-900 border-slate-800 shrink-0">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" /> Payout Calculator
              </CardTitle>
            </CardHeader>
            <CardContent>
              {n < 2 ? (
                <div className="text-center py-6 text-xs text-muted-foreground font-mono">Add 2+ picks to see payouts</div>
              ) : playstyle === "power" ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <span className="text-xs font-mono text-muted-foreground">{n}-pick Power multiplier</span>
                    <span className="text-lg font-bold font-mono text-primary">{multiplier}×</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-muted-foreground">Stake</span>
                    <span className="font-mono font-bold">${stakeNum.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-muted-foreground">Potential Payout</span>
                    <span className="font-mono font-bold text-emerald-400 text-xl">${powerPayout.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-muted-foreground">Profit if Win</span>
                    <span className="font-mono text-sm text-emerald-400">+${(powerPayout - stakeNum).toFixed(2)}</span>
                  </div>
                  <div className="bg-slate-800/50 rounded p-2 mt-2">
                    <div className="text-[10px] font-mono text-muted-foreground">Break-even hit rate</div>
                    <div className="text-sm font-mono font-bold text-primary mt-0.5">
                      {multiplier > 0 ? ((1 / multiplier) * 100).toFixed(1) : "—"}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground mb-3">{n}-pick Flex scenarios</div>
                  {Object.entries(flexPayouts).map(([scenario, mult]) => (
                    <div key={scenario} className="flex justify-between items-center bg-slate-800/40 px-3 py-2 rounded">
                      <span className="text-xs font-mono text-muted-foreground">{scenario} correct</span>
                      <div className="text-right">
                        <div className="text-xs font-mono text-slate-400">{mult}×</div>
                        <div className={`font-mono font-bold text-sm ${stakeNum * mult > stakeNum ? "text-emerald-400" : "text-rose-400"}`}>
                          ${(stakeNum * mult).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Model Edge — EV Intelligence */}
          <Card className="bg-slate-900 border-slate-800 flex-1">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                <Cpu className="w-4 h-4 text-violet-400" /> Model Edge
              </CardTitle>
            </CardHeader>
            <CardContent>
              {n < 2 ? (
                <div className="text-center py-4 text-xs text-muted-foreground font-mono">Add 2+ picks to see EV</div>
              ) : activeEV === null ? (
                <div className="text-center py-4 text-xs text-muted-foreground font-mono">Computing…</div>
              ) : (
                <div className="space-y-3">
                  {/* Per-leg breakdown */}
                  <div className="space-y-1.5">
                    {activeEV.legData.map((leg, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-slate-500 w-4 shrink-0">{i + 1}</span>
                        <span className="flex-1 truncate text-slate-300">{leg.name} <span className="text-slate-500">{leg.statType}</span></span>
                        {leg.direction === "more"
                          ? <ArrowUp className="w-3 h-3 text-emerald-400 shrink-0" />
                          : <ArrowDown className="w-3 h-3 text-rose-400 shrink-0" />}
                        <span className={`w-12 text-right shrink-0 font-bold ${
                          leg.pHit == null ? "text-slate-500" :
                          leg.pHit >= 0.6 ? "text-emerald-400" :
                          leg.pHit >= 0.5 ? "text-amber-400" : "text-rose-400"
                        }`}>
                          {leg.pHit != null ? `${(leg.pHit * 100).toFixed(0)}%` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-slate-800 pt-3 space-y-2">
                    {/* Probability chain */}
                    <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                      {activeEV.legData.map((l, i) => (
                        <span key={i}>
                          {l.pHit != null ? `${(l.pHit * 100).toFixed(0)}%` : "?%"}
                          {i < activeEV.legData.length - 1 ? " × " : ""}
                        </span>
                      ))}
                      <span className="text-foreground font-bold ml-1">= {(activeEV.pWin * 100).toFixed(1)}%</span>
                    </div>
                    {/* Combined P(win) */}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">P(win this entry)</span>
                      <span className={`font-mono font-bold text-sm ${
                        activeEV.pWin >= 0.25 ? "text-emerald-400" :
                        activeEV.pWin >= 0.12 ? "text-amber-400" : "text-rose-400"
                      }`}>
                        {(activeEV.pWin * 100).toFixed(1)}%
                      </span>
                    </div>
                    {/* EV */}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">Expected Value</span>
                      <div className="text-right">
                        <span className={`font-mono font-bold ${
                          activeEV.ev > 0 ? "text-emerald-400" :
                          activeEV.evPct > -20 ? "text-amber-400" : "text-rose-400"
                        }`}>
                          {activeEV.ev >= 0 ? "+" : ""}${activeEV.ev.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono ml-1">
                          ({activeEV.evPct >= 0 ? "+" : ""}{activeEV.evPct.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                    {/* Kelly Criterion */}
                    {(() => {
                      const b = (playstyle === "power" ? (multiplier - 1) : null);
                      if (b == null || b <= 0) return null;
                      const kellyFrac = (activeEV.pWin * b - (1 - activeEV.pWin)) / b;
                      const quarterKelly = Math.max(0, kellyFrac * 0.25);
                      const bankroll = 500;
                      const kellyStake = quarterKelly * bankroll;
                      return (
                        <div className="flex justify-between items-center border-t border-slate-800/60 pt-2">
                          <span className="text-[10px] font-mono text-muted-foreground uppercase">Kelly Stake</span>
                          <div className="text-right">
                            <span className={`font-mono font-bold text-sm ${kellyStake > 0 ? "text-violet-400" : "text-slate-500"}`}>
                              ${kellyStake.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono ml-1">(¼K · $500)</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {!activeEV.hasAllData && (
                    <p className="text-[10px] font-mono text-amber-500/70 mt-1">
                      ⚠ Some legs lack model data — using 50% fallback
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="p-3 bg-amber-950/30 border border-amber-700/40 rounded-lg flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
              <ClipboardCheck className="w-3.5 h-3.5" />
              {pendingCount} pending {pendingCount === 1 ? "entry" : "entries"} need results
            </div>
            <div className="text-xs text-amber-200/60 mt-0.5">
              Grade your picks in Journal to track CLV and calibrate your model
            </div>
          </div>
          <Link href="/journal">
            <Button size="sm" variant="outline" className="border-amber-700/50 text-amber-300 hover:bg-amber-950/40 font-mono text-xs shrink-0">
              Mark Results →
            </Button>
          </Link>
        </div>
      )}
    </div>

    {/* Loss Limit Confirmation Dialog */}
    <AlertDialog open={!!lossLimitDialog} onOpenChange={(open) => { if (!open) { setLossLimitDialog(null); } }}>
      <AlertDialogContent className="bg-slate-900 border-red-800/60">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-400">
            <ShieldAlert className="w-5 h-5" />
            Daily Loss Limit Reached
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300 font-mono text-sm space-y-2">
            <span className="block">
              You have lost <span className="text-red-400 font-bold">${lossLimitDialog?.totalLoss?.toFixed(2)}</span> today,
              which meets your daily limit of <span className="font-bold text-foreground">${lossLimitDialog?.limit?.toFixed(2)}</span>.
            </span>
            <span className="block text-slate-400">
              Rule 2: Set a daily loss limit and stick to it. No exceptions. Tilt is the #1 killer of bankrolls.
            </span>
            <span className="block text-amber-400 font-semibold">
              Override and log this entry anyway?
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-slate-700 text-muted-foreground hover:text-foreground">
            Stop — I'm done for today
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-700 hover:bg-red-600 text-white font-mono text-xs"
            onClick={async () => {
              setLossLimitDialog(null);
              await doSave();
            }}
          >
            Override — Log Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function LineTypePill({ type }: { type: string }) {
  if (type === "demon") return <Badge className="bg-fuchsia-900/50 text-fuchsia-300 border-fuchsia-700/50 text-[10px] font-mono shrink-0">demon</Badge>;
  if (type === "goblin") return <Badge className="bg-orange-900/50 text-orange-300 border-orange-700/50 text-[10px] font-mono shrink-0">goblin</Badge>;
  return null;
}
