import { cn } from "@/lib/utils";

const STALE_MS = 4 * 60 * 60 * 1000;

export type DataFreshnessBadgeProps = {
  activePropsCount: number;
  /** Epoch ms of oldest active line update, from dashboard `dataFreshness.ppLines`. */
  linesUpdatedAtMs?: number | null;
  className?: string;
};

/**
 * Command Center / header status: reflects whether the board has synced lines,
 * not a generic "always live" indicator.
 */
export function DataFreshnessBadge({
  activePropsCount,
  linesUpdatedAtMs = null,
  className,
}: DataFreshnessBadgeProps) {
  const isEmpty = activePropsCount === 0;
  const isStale =
    !isEmpty &&
    linesUpdatedAtMs != null &&
    Date.now() - linesUpdatedAtMs > STALE_MS;

  const tone = isEmpty ? "empty" : isStale ? "stale" : "live";

  const config = {
    empty: {
      label: "NO ACTIVE SLATE",
      detail: "Sync or seed lines",
      dot: "bg-amber-500",
      ping: "bg-amber-400",
      text: "text-amber-400/90",
    },
    stale: {
      label: "STALE",
      detail: `${activePropsCount} props · sync recommended`,
      dot: "bg-amber-500",
      ping: "bg-amber-400",
      text: "text-amber-400/90",
    },
    live: {
      label: "LIVE",
      detail: `${activePropsCount} active props`,
      dot: "bg-emerald-500",
      ping: "bg-emerald-400",
      text: "text-emerald-400/90",
    },
  }[tone];

  return (
    <div
      className={cn(
        "text-xs font-mono flex items-center gap-2 shrink-0",
        config.text,
        className,
      )}
      data-testid="data-freshness-badge"
      data-tone={tone}
    >
      <span className="relative flex h-2 w-2">
        {!isEmpty && tone === "live" && (
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              config.ping,
            )}
          />
        )}
        <span className={cn("relative inline-flex rounded-full h-2 w-2", config.dot)} />
      </span>
      <span className="uppercase tracking-wider font-semibold">{config.label}</span>
      <span className="hidden sm:inline text-muted-foreground normal-case tracking-normal font-normal">
        {config.detail}
      </span>
    </div>
  );
}
