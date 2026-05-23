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
        upper === "PLAY" && "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
        upper === "WATCH" && "text-amber-500 border-amber-500/30 bg-amber-500/10",
        upper === "PASS" && "text-slate-400 border-slate-700 bg-slate-800/50",
        className
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
        lower === "demon" && "text-fuchsia-400 bg-fuchsia-950/40",
        lower === "goblin" && "text-orange-400 bg-orange-950/40",
        className
      )}
      data-testid={`line-type-${lower}`}
    >
      {type}
    </Badge>
  );
}
