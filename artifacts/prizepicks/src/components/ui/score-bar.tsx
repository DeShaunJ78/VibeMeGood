import { cn } from "@/lib/utils";

export function ScoreBar({ 
  value, 
  max = 100, 
  label, 
  className,
  colorClass = "bg-cyan-500" 
}: { 
  value: number; 
  max?: number; 
  label?: string; 
  className?: string;
  colorClass?: string;
}) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  return (
    <div className={cn("flex flex-col gap-1.5 w-full", className)} data-testid={`score-bar-${label?.toLowerCase().replace(/\s+/g, '-')}`}>
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono text-foreground">{value.toFixed(1)}</span>
        </div>
      )}
      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all duration-500 ease-out", colorClass)} 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
