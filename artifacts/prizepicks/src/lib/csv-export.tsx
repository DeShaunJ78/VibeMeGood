import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Settings2 } from "lucide-react";

export type CsvColGroup = "meta" | "picks" | "financials" | "projections";

export const CSV_GROUPS: { id: CsvColGroup; label: string; desc: string; columns: string[] }[] = [
  {
    id: "meta",
    label: "Entry Metadata",
    desc: "date, result, type, playstyle, notes",
    columns: ["date", "entry_result", "entry_type", "playstyle", "notes"],
  },
  {
    id: "picks",
    label: "Pick Detail",
    desc: "sport, player, stat type, line, direction, pick result",
    columns: ["sport", "player", "stat_type", "line_value", "direction", "pick_result"],
  },
  {
    id: "financials",
    label: "Financials",
    desc: "stake, payout, P&L",
    columns: ["stake", "actual_payout", "pnl"],
  },
  {
    id: "projections",
    label: "Projections",
    desc: "your projection, P(over) %, CLV",
    columns: ["projection", "pover_pct", "clv"],
  },
];

export const CSV_COLS_KEY = "journal_csv_cols";
export const ALL_GROUPS: CsvColGroup[] = ["meta", "picks", "financials", "projections"];

export function loadCsvCols(): Set<CsvColGroup> {
  try {
    const raw = localStorage.getItem(CSV_COLS_KEY);
    if (!raw) return new Set(ALL_GROUPS);
    const parsed = JSON.parse(raw) as string[];
    const valid = parsed.filter((g): g is CsvColGroup => ALL_GROUPS.includes(g as CsvColGroup));
    return valid.length > 0 ? new Set(valid) : new Set(ALL_GROUPS);
  } catch {
    return new Set(ALL_GROUPS);
  }
}

export function saveCsvCols(cols: Set<CsvColGroup>): void {
  try {
    localStorage.setItem(CSV_COLS_KEY, JSON.stringify([...cols]));
  } catch {}
}

const CSV_PRESETS: { label: string; title: string; groups: CsvColGroup[] }[] = [
  { label: "All Columns",     title: "All column groups",                    groups: ["meta", "picks", "financials", "projections"] },
  { label: "Quick Review",    title: "Date · Player · Result · P&L",        groups: ["meta", "picks", "financials"] },
  { label: "Financials Only", title: "Stake · Payout · P&L",                groups: ["financials"] },
  { label: "Model Check",     title: "Player · Projection · P(Over) · CLV", groups: ["picks", "projections"] },
];

export function CsvColumnPickerDialog({
  open, onClose, onExport,
}: { open: boolean; onClose: () => void; onExport: (cols: Set<CsvColGroup>) => void }) {
  const [selected, setSelected] = useState<Set<CsvColGroup>>(() => loadCsvCols());

  function toggleGroup(id: CsvColGroup) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function applyPreset(groups: CsvColGroup[]) {
    setSelected(new Set(groups));
  }

  function isPresetActive(groups: CsvColGroup[]): boolean {
    return groups.length === selected.size && groups.every(g => selected.has(g));
  }

  function handleExport() {
    saveCsvCols(selected);
    onExport(selected);
    onClose();
  }

  const totalCols = CSV_GROUPS.filter(g => selected.has(g.id)).reduce((n, g) => n + g.columns.length, 0);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-slate-950 border-slate-800 max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            CSV Column Groups
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground font-mono -mt-1">
          Choose which column groups to include. Selection is saved for next time.
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {CSV_PRESETS.map(preset => (
            <button
              key={preset.label}
              title={preset.title}
              onClick={() => applyPreset(preset.groups)}
              className={`font-mono text-[10px] px-2 py-1 rounded border transition-colors ${
                isPresetActive(preset.groups)
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-300"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="space-y-3 mt-1">
          {CSV_GROUPS.map(g => (
            <div key={g.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors">
              <Checkbox
                id={`col-${g.id}`}
                checked={selected.has(g.id)}
                onCheckedChange={() => toggleGroup(g.id)}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <Label htmlFor={`col-${g.id}`} className="font-mono text-xs font-semibold cursor-pointer text-foreground">
                  {g.label}
                </Label>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{g.desc}</p>
              </div>
              <span className="text-[9px] font-mono text-slate-600 shrink-0 mt-0.5">{g.columns.length} cols</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-1 pt-3 border-t border-slate-800">
          <span className="text-[10px] font-mono text-muted-foreground">{totalCols} columns selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="font-mono text-xs h-7 border-slate-700">
              Cancel
            </Button>
            <Button size="sm" onClick={handleExport} className="font-mono text-xs h-7 gap-1.5">
              <Download className="w-3 h-3" /> Download CSV
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
