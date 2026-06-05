export interface PinnedPick {
  ppLineId: number;
  playerId: number;
  playerName: string;
  statType: string;
  sport: string;
  lineValue: number;
}

const LS_KEY = "lf_pinned_picks";

export function readPinnedPicks(): PinnedPick[] {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return [];
    const arr = JSON.parse(s) as unknown;
    return Array.isArray(arr) ? (arr as PinnedPick[]) : [];
  } catch {
    return [];
  }
}

export function writePinnedPicks(picks: PinnedPick[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(picks));
    window.dispatchEvent(new Event("pinned-picks-changed"));
  } catch {}
}

export function addPinnedPick(pick: PinnedPick): boolean {
  const current = readPinnedPicks();
  if (current.some(p => p.ppLineId === pick.ppLineId)) return false;
  writePinnedPicks([...current, pick]);
  return true;
}

export function removePinnedPick(ppLineId: number): void {
  writePinnedPicks(readPinnedPicks().filter(p => p.ppLineId !== ppLineId));
}

export function clearPinnedPicks(): void {
  try {
    localStorage.removeItem(LS_KEY);
    window.dispatchEvent(new Event("pinned-picks-changed"));
  } catch {}
}
