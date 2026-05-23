import { useState } from "react";
import { useListEntries, getListEntriesQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { format } from "date-fns";

export default function Journal() {
  const [search, setSearch] = useState("");
  
  const { data: entries, isLoading } = useListEntries(
    search ? { search } : undefined,
    { query: { queryKey: getListEntriesQueryKey(search ? { search } : undefined) } }
  );

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Journal</h1>
        <div className="relative w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search entries or notes..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 bg-slate-900 border-slate-800 font-mono text-sm" 
          />
        </div>
      </div>

      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col min-h-0">
        <div className="overflow-auto flex-1 p-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full bg-slate-800" />)}
            </div>
          ) : entries?.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              No entries found.
            </div>
          ) : (
            <div className="space-y-4">
              {entries?.map(entry => (
                <div key={entry.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-slate-800/50 pb-3">
                    <div className="flex items-center gap-4">
                      <div className="font-mono text-sm text-slate-400">{format(new Date(entry.entryDate), 'MMM d, yyyy')}</div>
                      <Badge variant="outline" className="bg-slate-800/50 text-slate-300 font-mono rounded-sm px-2">
                        {entry.pickCount}-Pick {entry.entryType}
                      </Badge>
                      <div className="font-mono text-sm"><span className="text-muted-foreground">Stake:</span> ${entry.stake}</div>
                      {entry.potentialPayout && <div className="font-mono text-sm"><span className="text-muted-foreground">To Win:</span> ${entry.potentialPayout}</div>}
                    </div>
                    <div>
                      <ResultBadge result={entry.result} actualPayout={entry.actualPayout} />
                    </div>
                  </div>
                  {entry.notes && (
                    <div className="text-sm text-slate-400 bg-slate-900 p-3 rounded border border-slate-800/50">
                      <span className="font-bold text-xs text-muted-foreground uppercase mr-2">Notes:</span> {entry.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultBadge({ result, actualPayout }: { result: string, actualPayout: number | null | undefined }) {
  const r = result.toLowerCase();
  if (r === 'pending') return <Badge variant="outline" className="text-amber-400 border-amber-400/30">PENDING</Badge>;
  if (r === 'won') return <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 bg-emerald-400/10 font-bold">WON {actualPayout ? `+$${actualPayout}` : ''}</Badge>;
  if (r === 'lost') return <Badge variant="outline" className="text-rose-400 border-rose-400/30 bg-rose-400/10">LOST</Badge>;
  if (r === 'tie' || r === 'push') return <Badge variant="outline" className="text-slate-400 border-slate-400/30">PUSH</Badge>;
  return <Badge variant="outline">{result}</Badge>;
}