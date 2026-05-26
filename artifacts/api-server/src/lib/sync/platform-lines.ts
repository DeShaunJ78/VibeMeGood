import { db } from "@workspace/db";
import { platformLinesTable } from "@workspace/db/schema";
import { logger } from "../logger";

interface UdOption {
  selection_header: string;
  choice: string;
}

interface UdLine {
  stat_value: string;
  status: string;
  line_type: string;
  over_under: {
    appearance_stat: {
      display_stat: string;
    };
  };
  options: UdOption[];
}

interface UdResponse {
  over_under_lines: UdLine[];
}

export interface PlatformSyncResult {
  underdog: number;
  skipped: string[];
}

export async function syncPlatformLines(): Promise<PlatformSyncResult> {
  const skipped: string[] = [];
  let underdogCount = 0;

  // ── Underdog Fantasy ────────────────────────────────────────────────
  try {
    const res = await fetch("https://api.underdogfantasy.com/v1/over_under_lines", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      skipped.push(`underdog (HTTP ${res.status})`);
      logger.warn({ status: res.status }, "Underdog Fantasy fetch non-OK");
    } else {
      const data = await res.json() as UdResponse;
      const lines = (data.over_under_lines ?? []).filter(
        l => l.status === "active" && l.line_type === "balanced",
      );

      for (const line of lines) {
        const playerName = line.options?.[0]?.selection_header;
        const statType   = line.over_under?.appearance_stat?.display_stat;
        const lineValue  = line.stat_value;
        if (!playerName || !statType || !lineValue) continue;

        await db
          .insert(platformLinesTable)
          .values({ playerName, statType, lineValue, platform: "underdog", syncedAt: new Date() })
          .onConflictDoUpdate({
            target: [platformLinesTable.playerName, platformLinesTable.statType, platformLinesTable.platform],
            set: { lineValue, syncedAt: new Date() },
          });
        underdogCount++;
      }
      logger.info({ count: underdogCount }, "Underdog Fantasy platform lines synced");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    logger.error({ err: e }, "Underdog Fantasy sync failed");
    skipped.push(`underdog (${msg})`);
  }

  // ── Pick6 — endpoint unreachable (HTTP 000 / connection refused) ────
  skipped.push("pick6 (endpoint unreachable — HTTP 000)");

  // ── Betr — requires session auth (HTTP 500 / SessionNotFoundException) ─
  skipped.push("betr (requires session auth — not publicly accessible)");

  return { underdog: underdogCount, skipped };
}
