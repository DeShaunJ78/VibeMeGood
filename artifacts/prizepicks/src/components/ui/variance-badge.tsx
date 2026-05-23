import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type VolatilityRating = "stable" | "elevated" | "high" | "boom_bust";

const RATING_CFG: Record<VolatilityRating, { label: string; className: string }> = {
  stable:   { label: "STABLE",    className: "bg-emerald-900/40 text-emerald-400 border-emerald-700/50" },
  elevated: { label: "ELEVATED",  className: "bg-amber-900/40 text-amber-400 border-amber-700/50" },
  high:     { label: "VOLATILE",  className: "bg-rose-900/40 text-rose-400 border-rose-700/50" },
  boom_bust:{ label: "BOOM/BUST", className: "bg-violet-900/40 text-violet-400 border-violet-700/50" },
};

const WARNING_LABELS: Record<string, string> = {
  back_to_back: "B2B",
  three_in_four: "3in4",
  blowout_sensitive: "Blowout",
  blowout_risk_extreme: "⚠ Blowout",
  minutes_risk: "Mins↓",
  usage_volatile: "Usage↑↑",
  rotation_unstable: "Rotation",
  pace_dependent: "Pace",
  altitude_impact: "Altitude",
};

interface VarianceBadgeProps {
  rating: string | null;
  warnings?: string[] | null;
  whyItMoves?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}

export function VarianceBadge({ rating, warnings = [], whyItMoves, size = "md", className }: VarianceBadgeProps) {
  if (!rating) return null;
  const c = RATING_CFG[rating as VolatilityRating] ?? RATING_CFG.stable;
  const safeWarnings = warnings ?? [];
  const textSize = size === "xs" ? "text-[9px]" : size === "sm" ? "text-[10px]" : "text-xs";
  const padding = size === "xs" ? "px-1 py-0.5" : "px-1.5 py-0.5";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1 cursor-default", className)}>
          <span className={cn(textSize, "font-mono font-bold rounded border", padding, c.className)}>
            {c.label}
          </span>
          {safeWarnings.slice(0, 2).map(w => (
            <span key={w} className={cn(textSize, "font-mono text-slate-500 border border-slate-700 rounded", padding)}>
              {WARNING_LABELS[w] ?? w}
            </span>
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent className="text-xs max-w-xs bg-slate-900 border-slate-700">
        <p className="font-mono font-bold mb-1">Volatility: {rating}</p>
        {safeWarnings.length > 0 && <p className="text-amber-400">⚠ {safeWarnings.join(", ")}</p>}
        {whyItMoves && <p className="mt-1 text-slate-300">{whyItMoves}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
