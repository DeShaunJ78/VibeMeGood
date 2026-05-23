import { useState } from "react";
import { useGetSlate } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LineTypeBadge, ActionTagBadge } from "@/components/ui/badges";
import { PropDetailSheet } from "@/components/prop-detail-sheet";
import { TeamPicksBoard } from "@/components/team-picks-board";
import { Search, Users, User } from "lucide-react";

export default function SlateBoard() {
  const [tab, setTab] = useState<"player" | "team">("player");
  const [sport, setSport] = useState<string>("all");
  const [actionTag, setActionTag] = useState<string>("all");
  const [minEdge, setMinEdge] = useState<string>("");
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);

  const { data: slate, isLoading } = useGetSlate({
    sport: sport !== "all" ? sport : undefined,
    actionTag: actionTag !== "all" ? actionTag : undefined,
    minEdgeScore: minEdge ? parseFloat(minEdge) : undefined,
  });

  const playerRows = slate?.filter((r: any) => r.pickCategory !== "team") ?? [];
  const teamRows = slate?.filter((r: any) => r.pickCategory === "team") ?? [];

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight mr-4">Slate Board</h1>
          <button
            onClick={() => setTab("player")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono transition-colors ${tab === "player" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground bg-slate-800/50"}`}
          >
            <User className="w-3.5 h-3.5" /> Player Picks
          </button>
          <button
            onClick={() => setTab("team")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono transition-colors ${tab === "team" ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground bg-slate-800/50"}`}
          >
            <Users className="w-3.5 h-3.5" /> Team Picks
            <Badge className="ml-1 bg-violet-700 text-white text-[10px] px-1 py-0 font-mono">NEW</Badge>
          </button>
        </div>
        {tab === "player" && (
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search player..." className="pl-8 bg-slate-900 border-slate-800 font-mono text-sm" readOnly />
            </div>
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger className="w-28 bg-slate-900 border-slate-800 font-mono text-sm">
                <SelectValue placeholder="Sport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sports</SelectItem>
                <SelectItem value="NBA">NBA</SelectItem>
                <SelectItem value="NFL">NFL</SelectItem>
                <SelectItem value="MLB">MLB</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actionTag} onValueChange={setActionTag}>
              <SelectTrigger className="w-28 bg-slate-900 border-slate-800 font-mono text-sm">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="PLAY">Play</SelectItem>
                <SelectItem value="WATCH">Watch</SelectItem>
                <SelectItem value="PASS">Pass</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Min Edge"
              value={minEdge}
              onChange={(e) => setMinEdge(e.target.value)}
              className="w-24 bg-slate-900 border-slate-800 font-mono text-sm"
            />
          </div>
        )}
      </div>

      {tab === "player" ? (
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col min-h-0">
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader className="bg-slate-950 sticky top-0 z-10">
                <TableRow className="border-slate-800 hover:bg-slate-950">
                  <TableHead className="w-20 font-mono text-xs">Sport</TableHead>
                  <TableHead className="font-mono text-xs">Player</TableHead>
                  <TableHead className="w-20 font-mono text-xs">Team</TableHead>
                  <TableHead className="w-20 font-mono text-xs">Opp</TableHead>
                  <TableHead className="w-36 font-mono text-xs">Stat</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-right">Line</TableHead>
                  <TableHead className="w-24 font-mono text-xs text-center">Type</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-right">Proj</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-right">Gap</TableHead>
                  <TableHead className="w-20 font-mono text-xs text-right">Edge</TableHead>
                  <TableHead className="w-24 font-mono text-xs text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-800">
                      {Array.from({ length: 11 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-800" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : playerRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-48 text-center text-muted-foreground">
                      No props matching criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  playerRows.map((row: any) => (
                    <TableRow
                      key={row.ppLineId}
                      className="border-slate-800 cursor-pointer hover:bg-slate-800/50 transition-colors"
                      onClick={() => setSelectedPropId(row.ppLineId)}
                    >
                      <TableCell className="font-mono text-xs text-primary">{row.sport}</TableCell>
                      <TableCell className="font-bold">{row.playerName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.teamAbbr}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.opponentAbbr ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.statType}</TableCell>
                      <TableCell className="font-mono text-sm font-bold text-right">{row.lineValue}</TableCell>
                      <TableCell className="text-center"><LineTypeBadge type={row.lineType} /></TableCell>
                      <TableCell className="font-mono text-xs text-right text-muted-foreground">{row.yourProjection?.toFixed(1) ?? "—"}</TableCell>
                      <TableCell className={`font-mono text-xs text-right ${(row.projectionGap ?? 0) > 0 ? "text-emerald-400" : (row.projectionGap ?? 0) < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                        {row.projectionGap != null ? ((row.projectionGap > 0 ? "+" : "") + row.projectionGap.toFixed(1)) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-right text-primary">{row.edgeScore?.toFixed(1) ?? "—"}</TableCell>
                      <TableCell className="text-center"><ActionTagBadge tag={row.actionTag} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <TeamPicksBoard rows={teamRows} isLoading={isLoading} onSelectProp={setSelectedPropId} />
      )}

      <PropDetailSheet
        ppLineId={selectedPropId}
        open={!!selectedPropId}
        onOpenChange={(open) => !open && setSelectedPropId(null)}
      />
    </div>
  );
}
