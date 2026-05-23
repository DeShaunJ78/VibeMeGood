import { useState } from "react";
import { useCreateEntry } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useEntry } from "@/lib/entry-context";
import { Target, Save, Zap, TrendingUp, TrendingDown, X, Flame, Smile } from "lucide-react";

// Real PrizePicks payout multipliers
const POWER_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };
const FLEX_PAYOUTS: Record<number, Record<string, number>> = {
  2: { "2/2": 3 },
  3: { "3/3": 5, "2/3": 1.25 },
  4: { "4/4": 10, "3/4": 2.5 },
  5: { "5/5": 20, "4/5": 4, "3/5": 1 },
  6: { "6/6": 40, "5/6": 6, "4/6": 1.5 },
};

export default function EntryBuilder() {
  const { toast } = useToast();
  const [stake, setStake] = useState<string>("25");
  const [playstyle, setPlaystyle] = useState<"power" | "flex">("power");
  const [notes, setNotes] = useState<string>("");
  const { picks, removePick, updateDirection, clearPicks } = useEntry();
  const createEntry = useCreateEntry();

  const stakeNum = parseFloat(stake) || 0;
  const n = picks.length;
  const multiplier = playstyle === "power" ? (POWER_MULTIPLIERS[n] ?? 0) : 0;
  const powerPayout = playstyle === "power" ? stakeNum * multiplier : 0;
  const flexPayouts = playstyle === "flex" && n >= 2 ? FLEX_PAYOUTS[n] ?? {} : {};

  async function handleSave() {
    if (picks.length < 2) {
      toast({ title: "Need more picks", description: "Minimum 2 picks required.", variant: "destructive" });
      return;
    }
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
  }

  return (
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

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-5 min-h-0">
        {/* Left: Pick List */}
        <div className="lg:col-span-2 flex flex-col bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-slate-800 bg-slate-950 font-bold flex items-center gap-2 text-sm shrink-0">
            <Target className="w-4 h-4 text-primary" />
            Active Picks ({picks.length}/6)
            <span className="ml-auto text-xs text-muted-foreground font-normal">Add props from the Slate Board</span>
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
                {picks.map((pick, i) => (
                  <div key={pick.ppLineId} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-mono font-bold text-muted-foreground shrink-0">
                      {i + 1}
                    </div>
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
          <Card className="bg-slate-900 border-slate-800 flex-1">
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
        </div>
      </div>
    </div>
  );
}

function LineTypePill({ type }: { type: string }) {
  if (type === "demon") return <Badge className="bg-fuchsia-900/50 text-fuchsia-300 border-fuchsia-700/50 text-[10px] font-mono shrink-0">demon</Badge>;
  if (type === "goblin") return <Badge className="bg-orange-900/50 text-orange-300 border-orange-700/50 text-[10px] font-mono shrink-0">goblin</Badge>;
  return null;
}
