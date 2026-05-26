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

  // ── Pick6 — parked GoDaddy domain; no active platform at pick6.com ──
  // Investigated: pick6.com serves a GoDaddy parking page. api.pick6.com has
  // no DNS record. pick6sports.com redirects to a defunct site (404).
  // No accessible pick'em platform found at any pick6.* URL.
  skipped.push("pick6 (domain is parked — no active platform found)");

  // ── Betr — requires Symfony PHP session auth on every endpoint ────────
  // Investigated: api.betr.app returns HTTP 500 + SessionNotFoundException on
  // ALL routes including session-init itself. Headers (platform/jurisdiction)
  // make no difference. No public API key system, no anonymous access path.
  skipped.push("betr (requires session auth — not publicly accessible)");

  // ── Sleeper — pick'em lines gated behind user authentication ─────────
  // Investigated: GraphQL schema has a Line type with outcome_value/subject/
  // sport. REST sleeper.com/lines returns [] for all sports. GraphQL queries
  // available_line_promotions, my_active_positions all return Unauthorized.
  // No anonymous access path exists via REST or GraphQL.
  skipped.push("sleeper (pick'em lines require user authentication)");

  // ── ParlayPlay — domain does not resolve from server environment ──────
  // Investigated: parlayplay.io and api.parlayplay.io both return HTTP 000
  // (no DNS resolution) from Replit's network. Cloudflare JS challenge blocks
  // all API paths even with a browser User-Agent.
  skipped.push("parlayplay (domain unreachable — Cloudflare bot protection)");

  return { underdog: underdogCount, skipped };
}
