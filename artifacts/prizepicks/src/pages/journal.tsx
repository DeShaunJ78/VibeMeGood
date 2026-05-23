import { useState, useRef } from "react";
import {
  useListEntries, getListEntriesQueryKey, useCreateEntry,
  useUpdateEntry, useUpdateEntryPick,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, ChevronDown, ChevronRight, Zap, Clock, CheckCircle } from "lucide-react";
import { format } from "date-fns";

const RESULT_STYLES: Record<string, { label: string; className: string }> = {
  win:     { label: "WIN",     className: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50" },
  loss:    { label: "LOSS",    className: "bg-rose-900/50 text-rose-300 border-rose-700/50" },
  partial: { label: "PARTIAL", className: "bg-amber-900/50 text-amber-300 border-amber-700/50" },
  pending: { label: "PENDING", className: "bg-slate-800 text-slate-400 border-slate-700" },
  refund:  { label: "REFUND",  className: "bg-slate-800 text-slate-300 border-slate-600" },
};

const PICK_RESULT_STYLES: Record<string, string> = {
  hit:     "text-emerald-400",
  miss:    "text-rose-400",
  dnp:     "text-amber-400",
  pending: "text-muted-foreground",
};

function ResultBadge({ result }: { result: string }) {
  const s = RESULT_STYLES[result] ?? RESULT_STYLES.pending;
  return (
    <Badge className={`font-mono text-[11px] border px-2 py-0.5 rounded-sm ${s.className}`}>
      {s.label}
    </Badge>
  );
}

function EmotionBadge({ emotion }: { emotion?: string | null }) {
  if (!emotion) return null;
  const map: Record<string, string> = {
    confident: "💪", neutral: "😐", frustrated: "😤", excited: "🔥", anxious: "😰",
  };
  return <span className="text-base" title={emotion}>{map[emotion] ?? "🎯"}</span>;
}

function MarkResultPanel({ entry, onDone }: { entry: any; onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const patchEntry = useUpdateEntry();
  const [pending, setPending] = useState<"win" | "loss" | "partial" | null>(null);
  const [partialPayout, setPartialPayout] = useState("");
  const [confirmResult, setConfirmResult] = useState<"win" | "loss" | "partial" | null>(null);

  const stake = Number(entry.stake ?? 0);
  const potentialPayout = Number(entry.potentialPayout ?? 0);

  async function mark(result: "win" | "loss" | "partial") {
    if (result === "partial" && !partialPayout) {
      setPending("partial");
      return;
    }
    setPending(null);
    const actualPayout =
      result === "win" ? potentialPayout :
      result === "loss" ? 0 :
      parseFloat(partialPayout || "0");
    try {
      await patchEntry.mutateAsync({
        id: entry.id,
        data: { result, actualPayout },
      });
      await qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
      toast({
        title: `Entry marked ${result.toUpperCase()}`,
        description: result === "win"
          ? `+$${(actualPayout - stake).toFixed(2)} P&L`
          : result === "loss"
          ? `-$${stake.toFixed(2)} P&L`
          : `+$${(actualPayout - stake).toFixed(2)} P&L (partial)`,
      });
      onDone();
    } catch {
      toast({ title: "Failed to update result", variant: "destructive" });
    }
  }

  if (confirmResult) {
    return (
      <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 space-y-2">
        <div className="text-[10px] font-mono text-muted-foreground uppercase">Confirm result</div>
        {confirmResult === "partial" ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Actual payout ($)"
              value={partialPayout}
              onChange={e => setPartialPayout(e.target.value)}
              className="bg-slate-950 border-slate-700 font-mono text-sm h-8 w-40"
              autoFocus
            />
            <Button size="sm" onClick={() => mark("partial")} disabled={patchEntry.isPending || !partialPayout} className="font-mono text-xs h-8 bg-amber-600 hover:bg-amber-700">
              Confirm PARTIAL
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmResult(null)} className="font-mono text-xs h-8 text-muted-foreground">
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">
              {confirmResult === "win"
                ? <span className="text-emerald-400">+${(potentialPayout - stake).toFixed(2)} P&L</span>
                : <span className="text-rose-400">-${stake.toFixed(2)} P&L</span>}
            </span>
            <Button size="sm" onClick={() => mark(confirmResult)} disabled={patchEntry.isPending} className={`font-mono text-xs h-8 ${confirmResult === "win" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-rose-800 hover:bg-rose-700"}`}>
              {patchEntry.isPending ? "Saving…" : `Confirm ${confirmResult.toUpperCase()}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmResult(null)} className="font-mono text-xs h-8 text-muted-foreground">
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700/60 rounded-lg px-3 py-2 flex items-center gap-2">
      <CheckCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider shrink-0">Mark Result</span>
      <div className="flex items-center gap-1.5 ml-1">
        <Button
          size="sm"
          onClick={() => setConfirmResult("win")}
          disabled={pending !== null || patchEntry.isPending}
          className="font-mono text-xs h-7 px-3 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-300 border border-emerald-800/60"
        >
          WIN
        </Button>
        <Button
          size="sm"
          onClick={() => setConfirmResult("loss")}
          disabled={pending !== null || patchEntry.isPending}
          className="font-mono text-xs h-7 px-3 bg-rose-900/60 hover:bg-rose-800 text-rose-300 border border-rose-800/60"
        >
          LOSS
        </Button>
        <Button
          size="sm"
          onClick={() => setConfirmResult("partial")}
          disabled={pending !== null || patchEntry.isPending}
          className="font-mono text-xs h-7 px-3 bg-amber-900/50 hover:bg-amber-800 text-amber-300 border border-amber-800/50"
        >
          PARTIAL
        </Button>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
        potential: ${potentialPayout.toFixed(2)}
      </span>
    </div>
  );
}

function PicksList({ entryId, picks }: { entryId: number; picks: any[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updatePick = useUpdateEntryPick();

  async function setPickResult(pickId: number, result: "hit" | "miss" | "dnp") {
    try {
      await updatePick.mutateAsync({ entryId, pickId, data: { result } });
      await qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
    } catch {
      toast({ title: "Failed to update pick", variant: "destructive" });
    }
  }

  return (
    <div>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Picks</div>
      <div className="space-y-1">
        {picks.map((pick: any, i: number) => (
          <div key={pick.id ?? i} className="flex items-center gap-2 text-xs font-mono bg-slate-900 border border-slate-800 px-3 py-2 rounded">
            <span className="text-muted-foreground w-4 shrink-0">{i + 1}</span>
            <span className="font-bold w-32 truncate shrink-0">{pick.playerName ?? `Pick ${i + 1}`}</span>
            <span className="text-slate-400 w-16 shrink-0">{pick.statType}</span>
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${pick.direction === "more" ? "bg-emerald-900/30 text-emerald-400" : "bg-rose-900/30 text-rose-400"}`}>
              {pick.direction === "more" ? "↑ MORE" : "↓ LESS"}
            </span>
            <span className="text-primary font-bold w-8 shrink-0">{pick.lineValue}</span>
            {pick.lineType && pick.lineType !== "standard" && (
              <Badge className={`text-[10px] px-1 py-0 shrink-0 ${pick.lineType === "demon" ? "bg-fuchsia-900/40 text-fuchsia-300" : "bg-orange-900/40 text-orange-300"}`}>
                {pick.lineType}
              </Badge>
            )}
            {pick.projectionGap != null && (
              <span className={`text-[10px] font-mono shrink-0 ${Number(pick.projectionGap) > 0 ? "text-emerald-500/70" : "text-rose-500/70"}`}>
                {Number(pick.projectionGap) > 0 ? "+" : ""}{Number(pick.projectionGap).toFixed(1)} edge
              </span>
            )}
            {pick.clv != null && (
              <span className="text-slate-500 shrink-0 ml-1">CLV: {Number(pick.clv) > 0 ? "+" : ""}{Number(pick.clv).toFixed(2)}</span>
            )}
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {pick.result === "pending" && pick.id ? (
                <>
                  <button
                    onClick={() => setPickResult(pick.id, "hit")}
                    disabled={updatePick.isPending}
                    className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-900/30 text-emerald-500 hover:bg-emerald-900/60 transition-colors border border-emerald-800/40"
                  >HIT</button>
                  <button
                    onClick={() => setPickResult(pick.id, "miss")}
                    disabled={updatePick.isPending}
                    className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-900/30 text-rose-500 hover:bg-rose-900/60 transition-colors border border-rose-800/40"
                  >MISS</button>
                  <button
                    onClick={() => setPickResult(pick.id, "dnp")}
                    disabled={updatePick.isPending}
                    className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors border border-slate-700"
                  >DNP</button>
                </>
              ) : (
                <span className={`font-bold uppercase ${PICK_RESULT_STYLES[pick.result] ?? "text-muted-foreground"}`}>
                  {pick.result}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: any }) {
  const [expanded, setExpanded] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explainText, setExplainText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const stake = Number(entry.stake);
  const payout = Number(entry.actualPayout ?? 0);
  const pnl =
    entry.result === "win"     ? payout - stake :
    entry.result === "partial" ? payout - stake :
    entry.result === "loss"    ? -stake : null;

  async function handleExplain(e: React.MouseEvent) {
    e.stopPropagation();
    setExplainText("");
    setExplaining(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/explain/entry/${entry.id}`, {
        method: "POST",
        signal: abortRef.current.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const p = JSON.parse(line.slice(6));
              if (p.text) setExplainText(prev => prev + p.text);
            } catch { /* ignore */ }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") setExplainText("Analysis failed. Try again.");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-900/50 transition-colors select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-slate-600 shrink-0 w-4">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        <span className="w-20 shrink-0 font-mono text-xs text-slate-400">
          {format(new Date(entry.entryDate), "MMM d")}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="font-mono text-[10px] border-slate-700 text-slate-300 bg-slate-800/50 px-2 py-0 rounded-sm uppercase">
            {entry.pickCount}-pick
          </Badge>
          <Badge variant="outline" className={`font-mono text-[10px] border px-2 py-0 rounded-sm uppercase ${entry.entryType === "flex" ? "border-emerald-800/60 text-emerald-400 bg-emerald-950/20" : "border-slate-700 text-slate-400 bg-slate-800/30"}`}>
            {entry.entryType}
          </Badge>
        </div>

        <div className="w-32 shrink-0 font-mono text-sm">
          <span className="text-muted-foreground text-xs">$</span>
          <span className="font-bold">{stake.toFixed(0)}</span>
          {entry.potentialPayout && (
            <span className="text-xs text-muted-foreground ml-1">→ ${Number(entry.potentialPayout).toFixed(0)}</span>
          )}
        </div>

        {entry.earlyExitEligible && (
          <Badge className="bg-indigo-900/40 text-indigo-300 border border-indigo-700/40 font-mono text-[10px] px-1.5 py-0 shrink-0">
            <Clock className="w-3 h-3 mr-1 inline" />
            EXIT {entry.earlyExitValue ? `$${Number(entry.earlyExitValue).toFixed(2)}` : ""}
          </Badge>
        )}

        <div className="flex-1 min-w-0 text-xs text-slate-400 truncate">
          {entry.notes}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <EmotionBadge emotion={entry.emotionalState} />
          {pnl != null && (
            <span className={`font-mono text-sm font-bold ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </span>
          )}
          <ResultBadge result={entry.result} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 px-4 py-3 space-y-3">
          {/* Inline result marking for pending entries */}
          {entry.result === "pending" && (
            <MarkResultPanel entry={entry} onDone={() => setExpanded(false)} />
          )}

          {Array.isArray(entry.picks) && entry.picks.length > 0 && (
            <PicksList entryId={entry.id} picks={entry.picks} />
          )}

          {entry.notes && (
            <div className="bg-slate-900 border border-slate-800/60 p-3 rounded text-xs text-slate-300">
              <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Session Notes</span>
              {entry.notes}
            </div>
          )}

          <div className="flex items-start gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExplain}
              disabled={explaining}
              className="font-mono text-xs border-slate-700 bg-slate-900 hover:bg-slate-800 h-7 shrink-0"
            >
              <Zap className="w-3 h-3 mr-1.5 text-amber-400" />
              {explaining ? "Analyzing…" : "AI Entry Analysis"}
            </Button>
          </div>

          {(explainText || explaining) && (
            <div className="bg-slate-900 border border-slate-800 rounded p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
              {explainText || <span className="animate-pulse text-muted-foreground">▋</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewEntryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutateAsync, isPending } = useCreateEntry();
  const [form, setForm] = useState({
    entryDate: new Date().toISOString().split("T")[0],
    entryType: "power",
    pickCount: "3",
    stake: "25",
    potentialPayout: "",
    actualPayout: "",
    result: "pending",
    emotionalState: "",
    notes: "",
  });

  function set(field: string, val: string) {
    setForm(f => ({ ...f, [field]: val }));
  }

  async function handleSave() {
    try {
      await mutateAsync({
        data: {
          entryDate: form.entryDate,
          entryType: form.entryType as any,
          pickCount: parseInt(form.pickCount),
          stake: parseFloat(form.stake),
          potentialPayout: form.potentialPayout ? parseFloat(form.potentialPayout) : null,
          emotionalState: form.emotionalState || null,
          notes: form.notes || null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
      toast({ title: "Entry logged", description: `${form.pickCount}-pick ${form.entryType} saved to journal.` });
      onClose();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">Log New Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Date</label>
              <Input type="date" value={form.entryDate} onChange={e => set("entryDate", e.target.value)} className="bg-slate-950 border-slate-800 font-mono text-sm h-8" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Result</label>
              <Select value={form.result} onValueChange={v => set("result", v)}>
                <SelectTrigger className="bg-slate-950 border-slate-800 font-mono text-sm h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pending","win","loss","partial","refund"].map(r => (
                    <SelectItem key={r} value={r} className="font-mono uppercase">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Type</label>
              <Select value={form.entryType} onValueChange={v => set("entryType", v)}>
                <SelectTrigger className="bg-slate-950 border-slate-800 font-mono text-sm h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="power" className="font-mono">Power</SelectItem>
                  <SelectItem value="flex"  className="font-mono">Flex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Picks</label>
              <Select value={form.pickCount} onValueChange={v => set("pickCount", v)}>
                <SelectTrigger className="bg-slate-950 border-slate-800 font-mono text-sm h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["2","3","4","5","6"].map(n => (
                    <SelectItem key={n} value={n} className="font-mono">{n}-pick</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Stake ($)</label>
              <Input value={form.stake} onChange={e => set("stake", e.target.value)} className="bg-slate-950 border-slate-800 font-mono text-sm h-8" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Potential Payout ($)</label>
              <Input value={form.potentialPayout} onChange={e => set("potentialPayout", e.target.value)} placeholder="—" className="bg-slate-950 border-slate-800 font-mono text-sm h-8" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Actual Payout ($)</label>
              <Input value={form.actualPayout} onChange={e => set("actualPayout", e.target.value)} placeholder="—" className="bg-slate-950 border-slate-800 font-mono text-sm h-8" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Emotional State</label>
            <Select value={form.emotionalState} onValueChange={v => set("emotionalState", v)}>
              <SelectTrigger className="bg-slate-950 border-slate-800 font-mono text-sm h-8">
                <SelectValue placeholder="Optional…" />
              </SelectTrigger>
              <SelectContent>
                {["confident","neutral","frustrated","excited","anxious"].map(e => (
                  <SelectItem key={e} value={e} className="font-mono capitalize">{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Reasoning, context, lessons learned…"
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="font-mono text-xs border-slate-700 h-8">Cancel</Button>
            <Button onClick={handleSave} disabled={isPending} className="font-mono text-xs h-8">
              {isPending ? "Saving…" : "Log Entry"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Journal() {
  const [search, setSearch]   = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const qc = useQueryClient();

  const { data: entries, isLoading } = useListEntries(
    search ? { search } : undefined,
    { query: { queryKey: getListEntriesQueryKey(search ? { search } : undefined) } }
  );

  const list = entries ?? [];
  const settled = list.filter((e: any) => e.result !== "pending");
  const pnl = settled.reduce((sum: number, e: any) => {
    const p = Number(e.actualPayout ?? 0);
    const s = Number(e.stake);
    return sum + (e.result === "win" || e.result === "partial" ? p - s : -s);
  }, 0);
  const wins = list.filter((e: any) => e.result === "win").length;
  const losses = list.filter((e: any) => e.result === "loss").length;
  const pending = list.filter((e: any) => e.result === "pending").length;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Journal</h1>
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span>{list.length} entries</span>
            <span>·</span>
            <span>{wins}W / {losses}L</span>
            {pending > 0 && <><span>·</span><span className="text-amber-400">{pending} pending</span></>}
            <span>·</span>
            <span className={`font-bold ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} P&L
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-52">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search notes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 bg-slate-900 border-slate-800 font-mono text-sm h-8"
            />
          </div>
          <Button
            onClick={() => setNewOpen(true)}
            className="font-mono text-xs h-8 px-3"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Log Entry
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-2 min-h-0">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 bg-slate-900 rounded-lg" />
          ))
        ) : list.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground font-mono text-sm">
            No entries found.
          </div>
        ) : (
          list.map((entry: any) => <EntryRow key={entry.id} entry={entry} />)
        )}
      </div>

      <NewEntryModal
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
          qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
        }}
      />
    </div>
  );
}
