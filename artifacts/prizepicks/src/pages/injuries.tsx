import { useState } from "react";
import { useListInjuries, getListInjuriesQueryKey, useListLineupConfirmations, getListLineupConfirmationsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Clock, Activity, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Injuries() {
  const [sport, setSport] = useState<string>("all");

  const { data: injuries, isLoading: loadingInjuries } = useListInjuries(
    sport !== "all" ? { sport } : undefined,
    { query: { queryKey: getListInjuriesQueryKey(sport !== "all" ? { sport } : undefined) } }
  );

  const { data: lineups, isLoading: loadingLineups } = useListLineupConfirmations(
    undefined,
    { query: { queryKey: getListLineupConfirmationsQueryKey() } }
  );

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Injuries & News Feed</h1>
        <div className="flex items-center gap-4">
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> Updated just now
          </div>
          <Select value={sport} onValueChange={setSport}>
            <SelectTrigger className="w-32 bg-slate-900 border-slate-800 font-mono text-sm">
              <SelectValue placeholder="Sport" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              <SelectItem value="NBA">NBA</SelectItem>
              <SelectItem value="NFL">NFL</SelectItem>
              <SelectItem value="MLB">MLB</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 overflow-hidden">
        <div className="flex flex-col overflow-hidden bg-slate-900 border border-slate-800 rounded-lg">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-500" />
            <h2 className="font-bold">Injury Reports</h2>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {loadingInjuries ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800 w-full" />)
            ) : injuries?.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No recent injuries</div>
            ) : (
              injuries?.map((injury) => (
                <Card key={injury.id} className="bg-slate-950 border-slate-800 overflow-hidden">
                  <div className={`h-1 w-full ${injury.status.toLowerCase().includes('out') ? 'bg-rose-500' : 'bg-amber-500'}`} />
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-bold text-lg">{injury.playerName}</div>
                        <div className="text-xs font-mono text-muted-foreground">{injury.playerTeam} • {injury.sport}</div>
                      </div>
                      <Badge variant="outline" className={injury.status.toLowerCase().includes('out') ? 'text-rose-400 border-rose-400/30' : 'text-amber-400 border-amber-400/30'}>
                        {injury.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-300 mt-2">{injury.note}</p>
                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-800/50 text-[10px] font-mono text-muted-foreground">
                      <span>Source: {injury.source}</span>
                      <span>{formatDistanceToNow(new Date(injury.reportedAt), { addSuffix: true })}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden bg-slate-900 border border-slate-800 rounded-lg">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <h2 className="font-bold">Lineup Confirmations</h2>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {loadingLineups ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 bg-slate-800 w-full" />)
            ) : lineups?.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No lineup confirmations</div>
            ) : (
              lineups?.map((lineup) => (
                <div key={lineup.id} className="p-3 bg-slate-950 border border-slate-800 rounded flex justify-between items-center">
                  <div>
                    <div className="font-bold">{lineup.playerName}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-1">Expected Mins: <span className="text-primary">{lineup.expectedMinutes || "—"}</span></div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className={lineup.isStarting ? 'text-emerald-400 border-emerald-400/30' : 'text-slate-400 border-slate-600'}>
                      {lineup.isStarting ? 'STARTING' : 'BENCH'}
                    </Badge>
                    <div className="text-[10px] font-mono text-muted-foreground mt-2">{formatDistanceToNow(new Date(lineup.confirmedAt), { addSuffix: true })}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}