import { useState } from "react";
import { useListInjuries, getListInjuriesQueryKey, useListLineupConfirmations, getListLineupConfirmationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Clock, Activity, CheckCircle2, PlusCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Injuries() {
  const [sport, setSport] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ playerName: "", playerTeam: "", sport: "NBA", status: "Questionable", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

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

  const { data: injuries, isLoading: loadingInjuries } = useListInjuries(
    sport !== "all" ? { sport } : undefined,
    { query: { queryKey: getListInjuriesQueryKey(sport !== "all" ? { sport } : undefined) } }
  );

  const { data: lineups, isLoading: loadingLineups } = useListLineupConfirmations(
    undefined,
    { query: { queryKey: getListLineupConfirmationsQueryKey() } }
  );

  return (
    <>
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Injuries & News Feed</h1>
        <div className="flex items-center gap-4">
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> Updated just now
          </div>
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
        <div className="flex flex-col overflow-hidden bg-slate-900 border border-slate-800 rounded-lg">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-500" />
            <h2 className="font-bold">Injury Reports</h2>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {loadingInjuries ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800 w-full" />)
            ) : injuries?.length === 0 ? (
              <div className="text-center py-12 space-y-3 px-4">
                <Activity className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                <div className="text-sm font-medium text-muted-foreground">No injury data yet</div>
                <div className="text-xs text-muted-foreground/70 max-w-sm mx-auto leading-relaxed">
                  Automated injury sync requires a connected feed (Rotowire or ESPN).
                  You can manually add injury notes below, or this page will populate once a feed is connected.
                </div>
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
        </div>

        <div className="flex flex-col overflow-hidden bg-slate-900 border border-slate-800 rounded-lg">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <h2 className="font-bold">Lineup Confirmations</h2>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {loadingLineups ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 bg-slate-800 w-full" />)
            ) : lineups?.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No lineup confirmations</div>
            ) : (
              lineups?.map((lineup) => (
                <div key={lineup.id} className="p-3 bg-slate-950 border border-slate-800 rounded flex justify-between items-center">
                  <div>
                    <div className="font-bold">{lineup.playerName}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-1">Expected Mins: <span className="text-primary">{lineup.expectedMinutes || "—"}</span></div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className={lineup.isStarting ? 'text-emerald-400 border-emerald-400/30' : 'text-slate-400 border-slate-600'}>
                      {lineup.isStarting ? 'STARTING' : 'BENCH'}
                    </Badge>
                    <div className="text-[10px] font-mono text-muted-foreground mt-2">{formatDistanceToNow(new Date(lineup.confirmedAt), { addSuffix: true })}</div>
                  </div>
                </div>
              ))
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