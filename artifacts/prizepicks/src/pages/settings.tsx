import { useGetDataHealth, getGetDataHealthQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, Database, Server } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";

export default function Settings() {
  const { data, isLoading } = useGetDataHealth({
    query: { queryKey: getGetDataHealthQueryKey() }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings & Data Health</h1>
        {data && (
          <Badge variant="outline" className={data.mode === 'live' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/50 font-mono" : "bg-amber-500/10 text-amber-500 border-amber-500/50 font-mono"}>
            {data.mode.toUpperCase()} MODE
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="w-5 h-5 text-primary" /> Data Providers</CardTitle>
            <CardDescription>Status of upstream API connections</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full bg-slate-800" />
                <Skeleton className="h-12 w-full bg-slate-800" />
              </div>
            ) : data?.providers ? (
              <div className="space-y-3">
                {data.providers.map((p: any, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
                    <span className="font-bold font-mono text-sm">{p.name || 'Unknown Provider'}</span>
                    <Badge variant="outline" className="text-emerald-400 border-emerald-400/30">HEALTHY</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No providers listed.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="flex items-center gap-2"><Server className="w-5 h-5 text-primary" /> Recent Syncs</CardTitle>
              <CardDescription className="mt-1">Latest automated data pulls</CardDescription>
            </div>
            <Button size="sm" variant="outline" className="border-slate-700 bg-slate-800 hover:bg-slate-700 font-mono text-xs">
              <RefreshCw className="w-3 h-3 mr-2" /> FORCE SYNC
            </Button>
          </CardHeader>
          <CardContent className="mt-4">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full bg-slate-800" />
                <Skeleton className="h-12 w-full bg-slate-800" />
              </div>
            ) : data?.lastPullLogs && data.lastPullLogs.length > 0 ? (
              <div className="space-y-2">
                {data.lastPullLogs.map(log => (
                  <div key={log.id} className="flex flex-col p-3 bg-slate-950 border border-slate-800 rounded gap-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm">{log.jobName}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {log.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground font-mono">
                      <span>{log.recordsProcessed || 0} records</span>
                      <span>{formatDistanceToNow(new Date(log.startedAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No recent sync logs.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}