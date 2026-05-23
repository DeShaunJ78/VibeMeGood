import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface UserSettings {
  id: number;
  userId: string;
  bankroll: string | null;
  unitSize: string | null;
  kellyFraction: string | null;
  maxUnitsPerEntry: number | null;
  dailyLossLimit: string | null;
  hitRateAssumptions: Record<string, number> | null;
  payoutConfig: Record<string, unknown> | null;
  edgeWeights: Record<string, number> | null;
  excludeDemonOvers: boolean | null;
  minEdgeToPlay: string | null;
  aiModel: string | null;
  excludedSports: string[] | null;
  varianceIntelEnabled: boolean;
  varianceSignals: {
    fatigue: boolean; environment: boolean; usage: boolean;
    matchup: boolean; narrative: boolean; referee: boolean;
  } | null;
  varianceModes: {
    aggressiveWeighting: boolean; stablePicksOnly: boolean;
    ceilingHunterMode: boolean; excludeHighVolatility: boolean;
  } | null;
  experimentalLabEnabled: boolean;
  experimentalLabAcknowledged: boolean;
}

const SETTINGS_KEY = ["user-settings"];

const base = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

async function fetchSettings(): Promise<UserSettings> {
  const r = await fetch(`${base()}/api/user-settings`);
  if (!r.ok) throw new Error("Failed to load settings");
  return r.json();
}

async function patchSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const r = await fetch(`${base()}/api/user-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("Failed to save settings");
  return r.json();
}

export function useUserSettings() {
  return useQuery<UserSettings>({
    queryKey: SETTINGS_KEY,
    queryFn: fetchSettings,
    staleTime: 30_000,
  });
}

export function useUpdateUserSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchSettings,
    onSuccess: (updated) => {
      qc.setQueryData(SETTINGS_KEY, updated);
    },
  });
}
