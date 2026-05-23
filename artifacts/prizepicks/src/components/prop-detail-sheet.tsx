import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetSlateRow } from "@workspace/api-client-react";
import { LineTypeBadge, ActionTagBadge } from "./ui/badges";
import { ScoreBar } from "./ui/score-bar";

interface PropDetailSheetProps {
  ppLineId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PropDetailSheet({ ppLineId, open, onOpenChange }: PropDetailSheetProps) {
  const { data: row, isLoading } = useGetSlateRow(ppLineId || 0, {
    query: {
      enabled: !!ppLineId && open,
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md md:max-w-lg border-l-slate-800 bg-slate-950 p-0 flex flex-col gap-0">
        {!ppLineId ? null : isLoading ? (
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-1/2 bg-slate-800" />
            <Skeleton className="h-4 w-1/3 bg-slate-800" />
            <Skeleton className="h-32 w-full bg-slate-800" />
            <Skeleton className="h-32 w-full bg-slate-800" />
          </div>
        ) : row ? (
          <>
            <SheetHeader className="p-6 pb-4 border-b border-slate-800 bg-slate-900/50">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <SheetTitle className="text-xl font-bold">{row.playerName}</SheetTitle>
                  <SheetDescription className="flex items-center gap-2 mt-1 font-mono text-xs">
                    <span className="text-muted-foreground">{row.teamAbbr} vs {row.opponentAbbr}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-primary">{row.sport}</span>
                  </SheetDescription>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <ActionTagBadge tag={row.actionTag} />
                  {row.isWatched && <span className="text-xs text-amber-500 font-mono">WATCHED</span>}
                </div>
              </div>
            </SheetHeader>
            <div className="p-6 overflow-y-auto space-y-8 flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-md flex flex-col items-center justify-center">
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-2">The Line</div>
                  <div className="text-3xl font-bold">{row.lineValue}</div>
                  <div className="text-sm text-slate-400 mt-1">{row.statType}</div>
                  <div className="mt-2"><LineTypeBadge type={row.lineType} /></div>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-md flex flex-col items-center justify-center">
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-2">Our Proj</div>
                  <div className="text-3xl font-bold text-primary">{row.yourProjection?.toFixed(1) || "—"}</div>
                  <div className="text-sm font-mono mt-1 text-slate-400">
                    Gap: {row.projectionGap ? (row.projectionGap > 0 ? `+${row.projectionGap.toFixed(1)}` : row.projectionGap.toFixed(1)) : "—"}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold font-mono uppercase text-muted-foreground tracking-wider mb-4 border-b border-slate-800 pb-2">Score Breakdown</h3>
                <div className="space-y-4">
                  <ScoreBar label="Edge Score" value={row.edgeScore || 0} colorClass="bg-primary" />
                  <ScoreBar label="Stability Score" value={row.stabilityScore || 0} colorClass="bg-emerald-500" />
                  <ScoreBar label="Market Support" value={row.marketSupportScore || 0} colorClass="bg-indigo-500" />
                  <ScoreBar label="Risk Score" value={row.riskScore || 0} colorClass="bg-rose-500" />
                </div>
              </div>

              {/* In a real app we'd fetch the full PropDetail for line history, etc. */}
              <div className="text-xs text-muted-foreground text-center py-8">
                Detailed history and external odds would load here.
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-muted-foreground">Prop not found</div>
        )}
      </SheetContent>
    </Sheet>
  );
}