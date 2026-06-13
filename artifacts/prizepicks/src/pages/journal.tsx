import { useState, useRef, useMemo, useEffect } from "react";
import {
  useListEntries, getListEntriesQueryKey, useCreateEntry,
  useUpdateEntry, useUpdateEntryPick,
} from "@workspace/api-client-react";
import type { EntryPickInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, ChevronDown, ChevronRight, Zap, Clock, CheckCircle, Filter, X, Trash2, Pencil, RotateCcw, AlertTriangle, Download, Bot } from "lucide-react";
import { format } from "date-fns";
import { flexExactPayout } from "@workspace/analytics";
import { CsvColumnPickerDialog, type CsvColGroup } from "@/lib/csv-export";

const SPORTS = ["NFL", "NBA", "MLB", "NHL", "WNBA", "MMA", "PGA", "NASCAR", "SOCCER"];

const RESULT_OPTIONS = ["win", "loss", "partial", "pending", "refund"];

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

  const allPicksGraded = Array.isArray(entry.picks) && entry.picks.length > 0
    && entry.picks.every((p: any) => p.result !== "pending");

  const picksSummary = (() => {
    if (!allPicksGraded || !Array.isArray(entry.picks)) return null;
    const hits = entry.picks.filter((p: any) => p.result === "hit").length;
    const dnps = entry.picks.filter((p: any) => p.result === "dnp").length;
    const effective = entry.picks.length - dnps;
    const suggested: "win" | "loss" | "partial" = hits === effective ? "win" : hits === 0 ? "loss" : "partial";
    return { hits, dnps, effective, suggested };
  })();

  const flexPartialHint = (() => {
    if (entry.entryType !== "flex" || !Array.isArray(entry.picks) || !allPicksGraded) return null;
    const n = entry.picks.length;
    const hits = entry.picks.filter((p: any) => p.result === "hit").length;
    const dnps = entry.picks.filter((p: any) => p.result === "dnp").length;
    const effective = n - dnps;
    const mult = flexExactPayout(effective, hits);
    if (!mult) return null;
    return Number(entry.stake) * mult;
  })();

  // Auto-open the confirm panel the moment all picks are graded (Power AND Flex).
  // Intentionally excludes confirmResult from deps so a user-cancel does not re-open.
  useEffect(() => {
    if (allPicksGraded && confirmResult === null && picksSummary) {
      setConfirmResult(picksSummary.suggested);
    }
  }, [allPicksGraded, entry.entryType]);

  if (confirmResult) {
    return (
      <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 space-y-2">
        <div className="text-[10px] font-mono text-muted-foreground uppercase">Confirm result</div>
        {allPicksGraded && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400/80 border border-amber-800/30 bg-amber-950/20 rounded px-2 py-1">
            <RotateCcw className="w-3 h-3 shrink-0" />
            Previous payout cleared — confirm the updated result to lock in the correct P&amp;L.
          </div>
        )}
        {confirmResult === "partial" ? (
          <div className="flex flex-col gap-2">
            {flexPartialHint != null && (
              <div className="text-[10px] font-mono text-amber-400/80">
                Flex calc: {entry.picks.filter((p: any) => p.result === "hit").length}/{entry.picks.length - entry.picks.filter((p: any) => p.result === "dnp").length} hits → expected ${flexPartialHint.toFixed(2)}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder={flexPartialHint != null ? `${flexPartialHint.toFixed(2)}` : "Actual payout ($)"}
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
    <div className="bg-slate-800/40 border border-slate-700/60 rounded-lg px-3 py-2 space-y-2">
      {picksSummary && !confirmResult && (
        <div className={`flex items-center gap-2 text-[10px] font-mono px-1 py-1 rounded border ${
          picksSummary.suggested === "win"
            ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-400"
            : picksSummary.suggested === "loss"
            ? "bg-rose-950/40 border-rose-800/40 text-rose-400"
            : "bg-amber-950/40 border-amber-800/40 text-amber-400"
        }`}>
          <CheckCircle className="w-3 h-3 shrink-0" />
          <span>All picks graded · {picksSummary.hits}/{picksSummary.effective} hits</span>
          <button
            onClick={() => setConfirmResult(picksSummary.suggested)}
            className="ml-auto underline underline-offset-2 font-bold uppercase hover:opacity-80"
          >
            Mark {picksSummary.suggested}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
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
    </div>
  );
}

function PicksList({ entryId, picks }: { entryId: number; picks: any[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updatePick = useUpdateEntryPick();
  const [regradingPickId, setRegradingPickId] = useState<number | null>(null);
  const [actualInputs, setActualInputs] = useState<Record<number, string>>({});

  async function setPickResult(pickId: number, result: "hit" | "miss" | "dnp") {
    const rawInput = actualInputs[pickId] ?? "";
    const actualResult = result !== "dnp" && rawInput !== "" ? parseFloat(rawInput) : undefined;
    try {
      await updatePick.mutateAsync({
        entryId,
        pickId,
        data: {
          result,
          ...(actualResult != null && !isNaN(actualResult) ? { actualResult } : {}),
        },
      });
      setActualInputs(prev => { const next = { ...prev }; delete next[pickId]; return next; });
      setRegradingPickId(null);
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
            {/* Line value: show locked → closing movement when CLV data is available */}
            <span className="font-bold shrink-0 whitespace-nowrap text-primary">
              {pick.lineValue}
              {pick.closingLine != null && (
                <>
                  <span className="text-slate-600 mx-0.5">→</span>
                  <span className={Number(pick.clv ?? 0) > 0 ? "text-emerald-400" : Number(pick.clv ?? 0) < 0 ? "text-rose-400" : "text-slate-400"}>
                    {Number(pick.closingLine).toFixed(1)}
                  </span>
                </>
              )}
            </span>
            {pick.lineType && pick.lineType !== "standard" && (
              <Badge className={`text-[10px] px-1 py-0 shrink-0 ${pick.lineType === "demon" ? "bg-fuchsia-900/40 text-fuchsia-300" : "bg-orange-900/40 text-orange-300"}`}>
                {pick.lineType}
              </Badge>
            )}
            {/* Fix 8: gap shown with tooltip noting data quality is unknown at time of entry */}
            {pick.projectionGap != null && (
              <span
                className={`text-[10px] font-mono shrink-0 ${Number(pick.projectionGap) > 0 ? "text-emerald-500/70" : "text-rose-500/70"}`}
                title="Gap at time of entry — data quality unknown"
              >
                {Number(pick.projectionGap) > 0 ? "+" : ""}{Number(pick.projectionGap).toFixed(1)} edge
              </span>
            )}
            {/* Auto-graded badge */}
            {pick.gradedBy === "auto" && (
              <span
                className="border border-sky-700/50 bg-sky-900/30 text-sky-400 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1"
                title="Result set automatically by the nightly grading run"
              >
                <Bot className="w-2.5 h-2.5" />AUTO
              </span>
            )}
            {/* CLV badge — shown whenever closing line is recorded, regardless of result */}
            {pick.closingLine != null && pick.clv != null && (() => {
              const clv = Number(pick.clv);
              const style = clv > 0
                ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/50"
                : clv < 0
                  ? "bg-rose-900/30 text-rose-400 border-rose-800/50"
                  : "bg-slate-800 text-slate-400 border-slate-700";
              return (
                <span
                  className={`${style} border text-[10px] font-bold font-mono px-1.5 py-0.5 rounded shrink-0`}
                  title={`Locked: ${pick.lineValue} · Closing: ${Number(pick.closingLine).toFixed(1)} · CLV: ${clv > 0 ? "+" : ""}${clv.toFixed(2)}`}
                >
                  CLV {clv > 0 ? "+" : ""}{clv.toFixed(2)}
                </span>
              );
            })()}
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {pick.result === "pending" && pick.id ? (
                <>
                  <input
                    type="number"
                    step="0.5"
                    placeholder="actual"
                    value={actualInputs[pick.id] ?? ""}
                    onChange={(e) => setActualInputs(prev => ({ ...prev, [pick.id]: e.target.value }))}
                    title="Enter actual stat result (optional — enables margin tracking)"
                    className="w-14 text-[10px] font-mono bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                  />
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
              ) : regradingPickId === pick.id ? (
                <>
                  <span className="text-[10px] text-slate-500 font-mono mr-0.5">re-grade:</span>
                  <input
                    type="number"
                    step="0.5"
                    placeholder="actual"
                    value={actualInputs[pick.id] ?? ""}
                    onChange={(e) => setActualInputs(prev => ({ ...prev, [pick.id]: e.target.value }))}
                    title="Enter actual stat result (optional — enables margin tracking)"
                    className="w-14 text-[10px] font-mono bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                  />
                  <button
                    onClick={() => { void setPickResult(pick.id, "hit"); }}
                    disabled={updatePick.isPending}
                    className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-900/30 text-emerald-500 hover:bg-emerald-900/60 transition-colors border border-emerald-800/40"
                  >HIT</button>
                  <button
                    onClick={() => { void setPickResult(pick.id, "miss"); }}
                    disabled={updatePick.isPending}
                    className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-900/30 text-rose-500 hover:bg-rose-900/60 transition-colors border border-rose-800/40"
                  >MISS</button>
                  <button
                    onClick={() => { void setPickResult(pick.id, "dnp"); }}
                    disabled={updatePick.isPending}
                    className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors border border-slate-700"
                  >DNP</button>
                  <button
                    onClick={() => setRegradingPickId(null)}
                    className="px-1 py-0.5 text-[10px] text-slate-500 hover:text-slate-300 font-mono"
                  >✕</button>
                </>
              ) : (
                <div className="flex items-center gap-1">
                  <span className={`font-bold uppercase ${PICK_RESULT_STYLES[pick.result] ?? "text-muted-foreground"}`}>
                    {pick.result}
                  </span>
                  {pick.result === "dnp" ? (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 bg-slate-800/60 border-slate-700 text-slate-400"
                      title="Did not play — no margin applicable"
                    >DNP</span>
                  ) : (() => {
                    const margin = pick.resultMargin != null
                      ? Number(pick.resultMargin)
                      : pick.actualResult != null
                        ? Number(pick.actualResult) - Number(pick.lineValue)
                        : null;
                    if (margin == null) return null;
                    const isHit = pick.result === "hit";
                    const isNearMiss = pick.result === "miss" && Math.abs(margin) <= 0.5;
                    return (
                      <>
                        {isNearMiss && (
                          <span
                            className="text-[10px] font-bold font-mono px-1 py-0.5 rounded border border-amber-700/50 bg-amber-900/30 text-amber-300 shrink-0"
                            title="Near-miss: fell short by ≤ 0.5"
                          >~</span>
                        )}
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                            isHit
                              ? "bg-emerald-900/20 border-emerald-800/40 text-emerald-400"
                              : "bg-rose-900/20 border-rose-800/40 text-rose-400"
                          }`}
                          title={`Actual: ${Number(pick.actualResult ?? 0).toFixed(1)} · Line: ${Number(pick.lineValue).toFixed(1)} · Margin: ${margin >= 0 ? "+" : ""}${margin.toFixed(2)}`}
                        >
                          {margin >= 0 ? "+" : ""}{margin.toFixed(1)} {margin >= 0 ? "over" : "miss"}
                        </span>
                      </>
                    );
                  })()}
                  {pick.id && (
                    <button
                      onClick={() => setRegradingPickId(pick.id)}
                      title="Re-grade this pick"
                      className="text-slate-700 hover:text-slate-400 transition-colors ml-0.5"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [reopening, setReopening] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const patchEntry = useUpdateEntry();

  async function handleReopenResult() {
    setReopening(true);
    try {
      await patchEntry.mutateAsync({
        id: entry.id,
        data: { result: "pending", actualPayout: null },
      });
      await qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
      toast({ title: "Entry re-opened", description: "Mark the correct result below." });
    } catch {
      toast({ title: "Failed to re-open entry", variant: "destructive" });
    } finally {
      setReopening(false);
    }
  }

  async function handleDeleteEntry(entryId: number) {
    setDeletingId(entryId);
    try {
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const res = await fetch(`${base}/api/entries/${entryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Entry deleted" });
      await qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
    } catch {
      toast({ title: "Failed to delete entry", variant: "destructive" });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  const stake = Number(entry.stake);
  const payout = Number(entry.actualPayout ?? 0);
  const pnl =
    entry.result === "win"     ? payout - stake :
    entry.result === "partial" ? payout - stake :
    entry.result === "loss"    ? -stake : null;

  const avgClv = (() => {
    if (!Array.isArray(entry.picks) || entry.picks.length === 0) return null;
    const vals = (entry.picks as any[])
      .map((p: any) => (p.clv != null ? parseFloat(p.clv) : null))
      .filter((v): v is number => v != null && !isNaN(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  const resultMismatch = (() => {
    if (entry.result === "pending") return false;
    if (!Array.isArray(entry.picks) || entry.picks.length === 0) return false;
    if (!entry.picks.every((p: any) => p.result !== "pending")) return false;
    const hits = entry.picks.filter((p: any) => p.result === "hit").length;
    const dnps  = entry.picks.filter((p: any) => p.result === "dnp").length;
    const effective = entry.picks.length - dnps;
    const suggested = hits === effective ? "win" : hits === 0 ? "loss" : "partial";
    return suggested !== entry.result;
  })();

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

        {entry.kellySuggested != null && (() => {
          const ks = Number(entry.kellySuggested);
          const st = Number(entry.stake ?? 0);
          const adherent = st <= ks * 1.10;
          return (
            <Badge
              title={`Half-Kelly at log time: $${ks.toFixed(2)}`}
              className={`font-mono text-[10px] px-1.5 py-0 rounded-sm border shrink-0 ${
                adherent
                  ? "bg-emerald-900/40 text-emerald-400 border-emerald-700/40"
                  : "bg-amber-900/40 text-amber-400 border-amber-700/40"
              }`}
            >
              {adherent ? "✓ Kelly" : "⚠ Over"}
            </Badge>
          );
        })()}

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
          {avgClv != null && (
            <span
              title="Avg CLV across picks with closing line data"
              className={`font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                avgClv > 0.05
                  ? "text-emerald-400 border-emerald-800/50 bg-emerald-950/30"
                  : avgClv < -0.05
                  ? "text-rose-400 border-rose-800/50 bg-rose-950/30"
                  : "text-slate-400 border-slate-700 bg-slate-800/30"
              }`}
            >
              CLV {avgClv > 0 ? "+" : ""}{avgClv.toFixed(2)}
            </span>
          )}
          {resultMismatch && (
            <button
              onClick={e => { e.stopPropagation(); setExpanded(true); }}
              title="Entry result may not match pick grades — click to review"
              className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border border-amber-700/40 bg-amber-900/20 text-amber-400 hover:bg-amber-900/40 transition-colors"
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              check result
            </button>
          )}
          <ResultBadge result={entry.result} />
          <div onClick={e => e.stopPropagation()}>
            {confirmDeleteId === entry.id ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDeleteEntry(entry.id)}
                  disabled={deletingId === entry.id}
                  className="text-xs text-rose-400 hover:text-rose-300 font-mono border border-rose-800 rounded px-2 py-0.5"
                >
                  {deletingId === entry.id ? "Deleting…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-xs text-slate-500 hover:text-slate-300 font-mono"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(entry.id)}
                className="text-slate-600 hover:text-rose-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 px-4 py-3 space-y-3">
          {/* Inline result marking for pending entries */}
          {entry.result === "pending" && (
            <MarkResultPanel entry={entry} onDone={() => setExpanded(false)} />
          )}

          {/* Re-open action for settled entries */}
          {entry.result !== "pending" && (
            <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
              <RotateCcw className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Result settled as <span className="text-slate-300">{entry.result.toUpperCase()}</span>
              </span>
              <button
                onClick={handleReopenResult}
                disabled={reopening}
                className="ml-auto text-[10px] font-mono font-bold uppercase text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                {reopening ? "Re-opening…" : "Re-open result"}
              </button>
            </div>
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

type LegDraft = {
  playerName: string;
  statType: string;
  lineValue: string;
  direction: "more" | "less";
  lineType: string;
  result: "pending" | "hit" | "miss" | "dnp";
};

function blankLeg(): LegDraft {
  return { playerName: "", statType: "", lineValue: "", direction: "more", lineType: "standard", result: "pending" };
}

function NewEntryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutateAsync, isPending } = useCreateEntry();
  const patchEntry = useUpdateEntry();
  const [form, setForm] = useState({
    entryDate: new Date().toISOString().split("T")[0],
    entryType: "power",
    stake: "25",
    potentialPayout: "",
    actualPayout: "",
    result: "pending",
    emotionalState: "",
    notes: "",
  });
  const [legs, setLegs] = useState<LegDraft[]>([blankLeg(), blankLeg(), blankLeg()]);

  function set(field: string, val: string) {
    setForm(f => ({ ...f, [field]: val }));
  }
  function setLeg(i: number, patch: Partial<LegDraft>) {
    setLegs(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLeg() {
    setLegs(ls => (ls.length >= 6 ? ls : [...ls, blankLeg()]));
  }
  function removeLeg(i: number) {
    setLegs(ls => (ls.length <= 1 ? ls : ls.filter((_, idx) => idx !== i)));
  }

  async function handleSave() {
    const decided = form.result !== "pending";

    // Build the legs the user typed by hand. A leg counts as "filled" once it
    // has a player and a line; blank trailing rows are ignored so the user can
    // leave spares without breaking the save.
    const filledLegs = legs.filter(l => l.playerName.trim() && l.lineValue.trim());
    if (filledLegs.length < 2) {
      toast({ title: "Add at least 2 legs", description: "Each leg needs a player and a line value.", variant: "destructive" });
      return;
    }
    if (filledLegs.length > 6) {
      toast({ title: "Too many legs", description: "PrizePicks slips are 2–6 picks.", variant: "destructive" });
      return;
    }
    const badLine = filledLegs.find(l => Number.isNaN(parseFloat(l.lineValue)));
    if (badLine) {
      toast({ title: "Invalid line value", description: `Check the line for ${badLine.playerName || "a leg"}.`, variant: "destructive" });
      return;
    }
    const missingStat = filledLegs.find(l => !l.statType.trim());
    if (missingStat) {
      toast({ title: "Add a stat for every leg", description: `${missingStat.playerName || "A leg"} is missing its stat type.`, variant: "destructive" });
      return;
    }

    // Partial entries settle to a specific payout — require it explicitly so we
    // never silently record a partial win as a full loss ($0).
    if (form.result === "partial" && !form.actualPayout) {
      toast({ title: "Enter the actual payout for a partial result", variant: "destructive" });
      return;
    }

    const picks: EntryPickInput[] = filledLegs.map(l => ({
      playerId:   null,
      playerName: l.playerName.trim(),
      statType:   l.statType.trim(),
      direction:  l.direction,
      lineValue:  parseFloat(l.lineValue),
      lineType:   l.lineType,
      result:     l.result,
    }));

    // Phase 1: create the entry + all legs atomically (server transaction).
    let created: Awaited<ReturnType<typeof mutateAsync>>;
    try {
      created = await mutateAsync({
        data: {
          entryDate: form.entryDate,
          entryType: form.entryType as any,
          pickCount: picks.length,
          stake: parseFloat(form.stake),
          potentialPayout: form.potentialPayout ? parseFloat(form.potentialPayout) : null,
          emotionalState: form.emotionalState || null,
          notes: form.notes || null,
          picks,
        },
      });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
      return;
    }

    // Phase 2 (only when logging an already-decided slate, e.g. backdating a
    // night you missed): persist the result + actual payout. The entry already
    // exists at this point, so a failure here is a partial success — don't
    // report a total failure or the user may re-submit and create a duplicate.
    if (decided && created?.id) {
      const stakeNum = parseFloat(form.stake) || 0;
      const potential = form.potentialPayout ? parseFloat(form.potentialPayout) : 0;
      const actualPayout =
        form.actualPayout ? parseFloat(form.actualPayout) :
        form.result === "win"    ? potential :
        form.result === "refund" ? stakeNum :
        0; // loss
      try {
        await patchEntry.mutateAsync({
          id: created.id,
          data: { result: form.result as any, actualPayout },
        });
      } catch {
        await qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
        toast({
          title: "Entry saved, but result not applied",
          description: "The entry was logged as pending — set its result from the journal.",
          variant: "destructive",
        });
        onClose();
        return;
      }
    }

    await qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
    const resultNote = decided ? ` (${form.result.toUpperCase()})` : "";
    toast({ title: "Entry logged", description: `${picks.length}-pick ${form.entryType}${resultNote} saved to journal.` });
    setLegs([blankLeg(), blankLeg(), blankLeg()]);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-foreground max-w-2xl max-h-[88vh] overflow-y-auto">
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

          <div className="grid grid-cols-2 gap-3">
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
              <label className="text-[10px] font-mono text-muted-foreground uppercase block mb-1">Stake ($)</label>
              <Input value={form.stake} onChange={e => set("stake", e.target.value)} className="bg-slate-950 border-slate-800 font-mono text-sm h-8" />
            </div>
          </div>

          {/* Hand-entered legs — type each pick exactly as it appears on your slip */}
          <div className="border border-slate-800 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono text-muted-foreground uppercase">Picks ({legs.filter(l => l.playerName.trim() && l.lineValue.trim()).length})</label>
              <Button type="button" variant="outline" onClick={addLeg} disabled={legs.length >= 6}
                className="font-mono text-[10px] border-slate-700 h-6 px-2">+ Add Leg</Button>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto_70px_auto_auto] gap-1.5 items-center text-[9px] font-mono text-muted-foreground uppercase px-0.5">
              <span>Player</span>
              <span>Stat</span>
              <span>O/U</span>
              <span>Line</span>
              <span>Result</span>
              <span />
            </div>
            {legs.map((leg, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_70px_auto_auto] gap-1.5 items-center">
                <Input value={leg.playerName} onChange={e => setLeg(i, { playerName: e.target.value })}
                  placeholder="Player" className="bg-slate-950 border-slate-800 font-mono text-xs h-8 px-2" />
                <Input value={leg.statType} onChange={e => setLeg(i, { statType: e.target.value })}
                  placeholder="Points" className="bg-slate-950 border-slate-800 font-mono text-xs h-8 px-2" />
                <Select value={leg.direction} onValueChange={v => setLeg(i, { direction: v as LegDraft["direction"] })}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 font-mono text-xs h-8 w-[68px] px-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="more" className="font-mono text-xs">More</SelectItem>
                    <SelectItem value="less" className="font-mono text-xs">Less</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={leg.lineValue} onChange={e => setLeg(i, { lineValue: e.target.value })}
                  placeholder="0.5" inputMode="decimal" className="bg-slate-950 border-slate-800 font-mono text-xs h-8 px-2" />
                <Select value={leg.result} onValueChange={v => setLeg(i, { result: v as LegDraft["result"] })}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 font-mono text-xs h-8 w-[88px] px-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pending","hit","miss","dnp"].map(r => (
                      <SelectItem key={r} value={r} className="font-mono text-xs uppercase">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="ghost" onClick={() => removeLeg(i)} disabled={legs.length <= 1}
                  className="font-mono text-xs h-8 w-8 p-0 text-muted-foreground hover:text-rose-400">×</Button>
              </div>
            ))}
            <p className="text-[9px] font-mono text-muted-foreground/70 pt-0.5">
              2–6 legs. Leave Result on PENDING now and grade them later, or fill them in if the slate already settled.
            </p>
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
            <Button onClick={handleSave} disabled={isPending || patchEntry.isPending} className="font-mono text-xs h-8">
              {isPending || patchEntry.isPending ? "Saving…" : "Log Entry"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SortDir = "asc" | "desc";

const RESULT_ORDER: Record<string, number> = { win: 0, partial: 1, pending: 2, loss: 3, refund: 4 };

export default function Journal() {
  const [search, setSearch]     = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [result, setResult]     = useState("");
  const [sport, setSport]       = useState("");
  const [newOpen, setNewOpen]                 = useState(false);
  const [showAutoGradedOnly, setShowAutoGradedOnly] = useState(false);
  const [csvPickerOpen, setCsvPickerOpen] = useState(false);
  const [sortCol, setSortCol]   = useState<string>("date");
  const [sortDir, setSortDir]   = useState<SortDir>("desc");
  const qc = useQueryClient();

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  function sortLabel(col: string, label: string) {
    const active = sortCol === col;
    return `${label}${active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}`;
  }

  const params = {
    ...(search   ? { search }   : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo   ? { dateTo }   : {}),
    ...(result   ? { result }   : {}),
    ...(sport    ? { sport }    : {}),
  };
  const hasParams = Object.keys(params).length > 0;

  const { data: entries, isLoading } = useListEntries(
    hasParams ? params : undefined,
    { query: { queryKey: getListEntriesQueryKey(hasParams ? params : undefined) } }
  );

  const rawList = entries ?? [];

  const list = useMemo(() => {
    return [...rawList].sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortCol) {
        case "date":
          cmp = new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime();
          break;
        case "result":
          cmp = (RESULT_ORDER[a.result] ?? 99) - (RESULT_ORDER[b.result] ?? 99);
          break;
        case "pnl": {
          const getPnl = (e: any) => {
            if (e.result === "win" || e.result === "partial") return Number(e.actualPayout ?? 0) - Number(e.stake);
            if (e.result === "loss") return -Number(e.stake);
            return 0;
          };
          cmp = getPnl(a) - getPnl(b);
          break;
        }
        case "stake":
          cmp = Number(a.stake) - Number(b.stake);
          break;
        case "pickCount":
          cmp = (a.pickCount ?? 0) - (b.pickCount ?? 0);
          break;
        default:
          cmp = new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime();
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rawList, sortCol, sortDir]);

  // Auto-graded counts — scoped to picks graded today (gradedAt date === today)
  // Legacy picks without gradedAt are excluded from the banner but still show the badge.
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const autoGradedPickCount = useMemo(() =>
    list.reduce((n: number, e: any) => n + (e.picks ?? []).filter((p: any) => {
      if (p.gradedBy !== "auto") return false;
      if (!p.gradedAt) return false;
      return String(p.gradedAt).slice(0, 10) === todayStr;
    }).length, 0),
    [list, todayStr],
  );
  const autoGradedEntryIds = useMemo(() =>
    new Set<number>(list.filter((e: any) =>
      (e.picks ?? []).some((p: any) => p.gradedBy === "auto" && p.gradedAt && String(p.gradedAt).slice(0, 10) === todayStr)
    ).map((e: any) => e.id)),
    [list, todayStr],
  );

  const displayList = useMemo(() =>
    showAutoGradedOnly ? list.filter((e: any) => autoGradedEntryIds.has(e.id)) : list,
    [list, showAutoGradedOnly, autoGradedEntryIds],
  );

  const settled = displayList.filter((e: any) => e.result !== "pending");
  const pnl = settled.reduce((sum: number, e: any) => {
    const p = Number(e.actualPayout ?? 0);
    const s = Number(e.stake);
    return sum + (e.result === "win" || e.result === "partial" ? p - s : -s);
  }, 0);
  const wins    = displayList.filter((e: any) => e.result === "win").length;
  const losses  = displayList.filter((e: any) => e.result === "loss").length;
  const pending = displayList.filter((e: any) => e.result === "pending").length;

  const activeFilterCount = [dateFrom, dateTo, result, sport].filter(Boolean).length + (showAutoGradedOnly ? 1 : 0);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setResult("");
    setSport("");
    setSearch("");
    setShowAutoGradedOnly(false);
  }

  function handleExportCsv(cols?: Set<CsvColGroup>) {
    const qs = new URLSearchParams();
    if (search)   qs.set("search", search);
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo)   qs.set("dateTo", dateTo);
    if (result)   qs.set("result", result);
    if (sport)    qs.set("sport", sport);
    if (cols && cols.size < 4) qs.set("cols", [...cols].join(","));
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const url = `${base}/api/entries/export.csv?${qs.toString()}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="space-y-3 h-full flex flex-col">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
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
          <div className="relative w-44">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search notes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 bg-slate-900 border-slate-800 font-mono text-sm h-8"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setCsvPickerOpen(true)}
            title="Export visible entries to CSV"
            className="font-mono text-xs h-8 px-3 border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button
            onClick={() => setNewOpen(true)}
            className="font-mono text-xs h-8 px-3"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Log Entry
          </Button>
        </div>
      </div>

      {/* ── Auto-graded banner ── */}
      {autoGradedPickCount > 0 && (
        <div className="flex items-center gap-2 shrink-0 px-3 py-2 rounded-md border border-sky-800/50 bg-sky-950/40 text-sky-300 font-mono text-xs">
          <Bot className="w-3.5 h-3.5 shrink-0 text-sky-400" />
          <span>
            <span className="font-bold">{autoGradedPickCount}</span>
            {" "}pick{autoGradedPickCount !== 1 ? "s" : ""} auto-graded
            {" "}across{" "}
            <span className="font-bold">{autoGradedEntryIds.size}</span>
            {" "}entr{autoGradedEntryIds.size !== 1 ? "ies" : "y"}
            {" "}— verify results are correct
          </span>
          <button
            onClick={() => setShowAutoGradedOnly(v => !v)}
            className={`ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded border transition-colors ${
              showAutoGradedOnly
                ? "bg-sky-700/50 border-sky-600/60 text-sky-200"
                : "border-sky-700/50 text-sky-400 hover:bg-sky-900/40"
            }`}
          >
            {showAutoGradedOnly ? "✓ Filtered" : "Review"}
          </button>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />

        {/* Date From */}
        <div className="flex items-center gap-1">
          <label className="text-[10px] font-mono text-slate-500 uppercase">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-32 px-2"
          />
        </div>

        {/* Date To */}
        <div className="flex items-center gap-1">
          <label className="text-[10px] font-mono text-slate-500 uppercase">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-32 px-2"
          />
        </div>

        {/* Result */}
        <Select value={result || "_all"} onValueChange={v => setResult(v === "_all" ? "" : v)}>
          <SelectTrigger className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-28">
            <SelectValue placeholder="Result" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="font-mono text-xs">All results</SelectItem>
            {RESULT_OPTIONS.map(r => (
              <SelectItem key={r} value={r} className="font-mono text-xs uppercase">{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sport */}
        <Select value={sport || "_all"} onValueChange={v => setSport(v === "_all" ? "" : v)}>
          <SelectTrigger className="bg-slate-900 border-slate-800 font-mono text-xs h-7 w-24">
            <SelectValue placeholder="Sport" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="font-mono text-xs">All sports</SelectItem>
            {SPORTS.map(s => (
              <SelectItem key={s} value={s} className="font-mono text-xs">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear button — only when filters active */}
        {(activeFilterCount > 0 || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="font-mono text-xs h-7 px-2 text-slate-400 hover:text-white hover:bg-slate-800 gap-1"
          >
            <X className="w-3 h-3" />
            Clear
            {activeFilterCount > 0 && (
              <span className="ml-0.5 bg-primary/20 text-primary rounded-full px-1.5 py-0 text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>
        )}
      </div>

      {/* ── Sort bar ── */}
      <div className="flex items-center gap-1 shrink-0 flex-wrap">
        <span className="text-[10px] font-mono text-slate-500 uppercase mr-1">Sort:</span>
        {(["date", "result", "pnl", "pickCount", "stake"] as const).map(col => {
          const labels: Record<string, string> = { date: "Date", result: "Result", pnl: "P&L", pickCount: "Picks", stake: "Stake" };
          return (
            <button
              key={col}
              onClick={() => toggleSort(col)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                sortCol === col
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              {sortLabel(col, labels[col])}
            </button>
          );
        })}
      </div>

      {/* ── Entry list ── */}
      <div className="flex-1 overflow-auto space-y-2 min-h-0">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 bg-slate-900 rounded-lg" />
          ))
        ) : displayList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground font-mono text-sm">
            <span>No entries found.</span>
            {(hasParams || showAutoGradedOnly) && (
              <button
                onClick={clearFilters}
                className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          displayList.map((entry: any) => <EntryRow key={entry.id} entry={entry} />)

        )}
      </div>

      <CsvColumnPickerDialog
        open={csvPickerOpen}
        onClose={() => setCsvPickerOpen(false)}
        onExport={cols => handleExportCsv(cols)}
      />

      <NewEntryModal
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
          void qc.invalidateQueries({ queryKey: getListEntriesQueryKey() });
        }}
      />
    </div>
  );
}
