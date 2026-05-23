import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function ActionTagBadge({ tag, className }: { tag: string | null | undefined, className?: string }) {
  if (!tag) return null;
  const upper = tag.toUpperCase();

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-xs px-1.5 py-0",
        upper === "PLAY"    && "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
        upper === "WATCH"   && "text-amber-500 border-amber-500/30 bg-amber-500/10",
        upper === "PASS"    && "text-slate-400 border-slate-700 bg-slate-800/50",
        upper === "NO-PLAY" && "text-rose-400 border-rose-500/30 bg-rose-500/10",
        className,
      )}
      data-testid={`action-tag-${upper.toLowerCase()}`}
    >
      {upper}
    </Badge>
  );
}

export function LineTypeBadge({ type, className }: { type: string | null | undefined, className?: string }) {
  if (!type) return null;
  const lower = type.toLowerCase();

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] px-1 py-0 border-0",
        lower === "standard" && "text-cyan-400 bg-cyan-950/40",
        lower === "demon"    && "text-fuchsia-400 bg-fuchsia-950/40",
        lower === "goblin"   && "text-orange-400 bg-orange-950/40",
        className,
      )}
      data-testid={`line-type-${lower}`}
    >
      {type}
    </Badge>
  );
}

/** P(over) pill — color-coded by probability */
export function POverBadge({ pOver, noPlayReason, className }: {
  pOver: number | null | undefined;
  noPlayReason?: string | null;
  className?: string;
}) {
  if (noPlayReason) {
    const label = {
      insufficient_data:  "No Data",
      player_out:         "OUT",
      game_time_decision: "GTD",
      stale_projection:   "Stale",
      low_data_quality:   "Low DQ",
    }[noPlayReason] ?? "N/A";
    return (
      <Badge variant="outline" className={cn("font-mono text-[10px] px-1 py-0 text-rose-400 border-rose-500/20 bg-rose-950/20", className)}>
        {label}
      </Badge>
    );
  }
  if (pOver == null) return <span className="text-slate-600 text-xs font-mono">—</span>;

  const color =
    pOver >= 60 ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/20" :
    pOver >= 54 ? "text-green-400 border-green-500/30 bg-green-950/20" :
    pOver >= 48 ? "text-amber-400 border-amber-500/30 bg-amber-950/20" :
    pOver >= 42 ? "text-orange-400 border-orange-500/30 bg-orange-950/20" :
                  "text-rose-400 border-rose-500/30 bg-rose-950/20";

  return (
    <Badge variant="outline" className={cn(`font-mono text-[10px] px-1.5 py-0 ${color}`, className)}>
      {pOver.toFixed(0)}%↑
    </Badge>
  );
}

/** Data quality score pill */
export function DQBadge({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return null;
  const color =
    score >= 80 ? "text-emerald-400" :
    score >= 60 ? "text-amber-400" :
    score >= 40 ? "text-orange-400" :
                  "text-rose-400";
  return (
    <span className={cn(`font-mono text-[10px] ${color}`, className)} title={`Data quality: ${score}/100`}>
      DQ{score}
    </span>
  );
}
