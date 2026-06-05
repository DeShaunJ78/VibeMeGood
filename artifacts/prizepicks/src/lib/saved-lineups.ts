import type { LineupFactoryConfig, LineupFactoryResult } from "@workspace/api-client-react";

export interface SavedLineup {
  id: string;
  autoName: string;
  label?: string;
  savedAt: number;
  cfg: LineupFactoryConfig;
  result: LineupFactoryResult;
}

const LS_KEY = "lf_saved_lineups";
const MAX_ENTRIES = 10;

const FORMAT_LABELS: Record<string, string> = {
  power: "Power",
  flex: "Flex",
  stack: "Stack",
  team_plus_player: "Team+Player",
};

export function buildAutoName(cfg: LineupFactoryConfig, savedAt: number): string {
  const fmt = FORMAT_LABELS[cfg.format] ?? cfg.format;
  const picks = `${cfg.picksPerEntry}-pick`;
  const date = new Date(savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt} ${picks} · ${date}`;
}

export function readSavedLineups(): SavedLineup[] {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return [];
    const arr = JSON.parse(s) as unknown;
    return Array.isArray(arr) ? (arr as SavedLineup[]) : [];
  } catch {
    return [];
  }
}

export function appendSavedLineup(cfg: LineupFactoryConfig, result: LineupFactoryResult): SavedLineup {
  const now = Date.now();
  const entry: SavedLineup = {
    id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
    autoName: buildAutoName(cfg, now),
    savedAt: now,
    cfg,
    result,
  };
  const current = readSavedLineups();
  const next = [entry, ...current].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("saved-lineups-changed"));
  } catch {}
  return entry;
}

export function updateSavedLineupLabel(id: string, label: string): void {
  const current = readSavedLineups();
  const next = current.map(e => (e.id === id ? { ...e, label: label.trim() || undefined } : e));
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("saved-lineups-changed"));
  } catch {}
}

export function deleteSavedLineup(id: string): void {
  const current = readSavedLineups();
  const next = current.filter(e => e.id !== id);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("saved-lineups-changed"));
  } catch {}
}
