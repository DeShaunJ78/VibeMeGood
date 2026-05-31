import { useState } from "react";
import {
  useGenerateLineupFactory,
  type LineupFactoryConfig,
  type GeneratedLineup,
  type FactoryScoredProp,
  type PortfolioStats,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { useEntry } from "@/lib/entry-context";
import {
  Factory, Zap, TrendingUp, DollarSign, AlertTriangle,
  ChevronRight, BarChart2, RefreshCw, CheckCircle2, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS: LineupFactoryConfig = {
  format: "power",
  picksPerEntry: 3,
  numEntries: 5,
  varianceProfile: "conservative",
  optimizationObjective: "balanced_growth",
  maxPlayerExposure: 0.40,
  maxPickExposure: 0.40,
  maxTeamExposure: 0.50,
  maxGameExposure: 0.50,
  maxPairwiseOverlap: 0.34,
  stakePerEntry: 25,
  allowGtdPlayers: false,
  allowSingleBookData: true,
  allowStaleMarketData: true,
  demonUnderAllowed: false,
  monteCarloIterations: 10000,
};

const ITERATION_OPTIONS = [
  { label: "1K", value: 1000 },
  { label: "5K", value: 5000 },
  { label: "10K", value: 10000 },
  { label: "25K", value: 25000 },
  { label: "50K", value: 50000 },
];

const FORMAT_LABELS: Record<string, string> = {
  power: "Power Play", flex: "Flex Play",
  stack: "Stack", team_plus_player: "Team + Player",
};
const PROFILE_LABELS: Record<string, { label: string; color: string }> = {
  conservative: { label: "Conservative", color: "text-emerald-400" },
  balanced:     { label: "Balanced",     color: "text-blue-400" },
  aggressive:   { label: "Aggressive",   color: "text-amber-400" },
  chaos:        { label: "Chaos",        color: "text-red-400" },
  custom:       { label: "Custom",       color: "text-purple-400" },
};
const OBJECTIVE_LABELS: Record<string, string> = {
  max_ev:          "Max EV",
  max_profit_prob: "Max Profit Probability",
  min_drawdown:    "Min Drawdown",
  balanced_growth: "Balanced Growth",
  high_ceiling:    "High Ceiling",
};
const EXPOSURE_OPTIONS = [
  { label: "20%", value: 0.20 }, { label: "30%", value: 0.30 },
  { label: "40%", value: 0.40 }, { label: "50%", value: 0.50 },
  { label: "70%", value: 0.70 }, { label: "Unlimited", value: 1.0 },
];
const OVERLAP_OPTIONS = [
  { label: "25%", value: 0.25 }, { label: "34%", value: 0.34 },
  { label: "50%", value: 0.50 }, { label: "75%", value: 0.75 },
  { label: "Unlimited", value: 1.0 },
];

function pct(v: number) { return `${Math.round(v * 100)}%`; }
function dollars(v: number) { return `$${v.toFixed(2)}`; }
function sign(v: number) { return v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`; }

// ─── Reusable pick-group toggle ───────────────────────────────────────────────
function ToggleGroup<T extends string | number>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { label: string; value: T }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 rounded text-xs font-mono border transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-slate-800 text-muted-foreground border-slate-700 hover:border-slate-500 hover:text-foreground",
          )}
        >{o.label}</button>
      ))}
    </div>
  );
}

// ─── Exposure select ──────────────────────────────────────────────────────────
function ExposureSelect({ label, value, onChange, options = EXPOSURE_OPTIONS }: {
  label: string; value: number;
  onChange: (v: number) => void;
  options?: typeof EXPOSURE_OPTIONS;
}) {
  const valStr = String(value);
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs text-muted-foreground shrink-0">{label}</Label>
      <Select value={valStr} onValueChange={v => onChange(parseFloat(v))}>
        <SelectTrigger className="h-7 text-xs w-28 bg-slate-800 border-slate-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={String(o.value)} value={String(o.value)} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Config panel ─────────────────────────────────────────────────────────────
function ConfigPanel({
  cfg, onChange, onGenerate, loading,
}: { cfg: LineupFactoryConfig; onChange: (c: LineupFactoryConfig) => void; onGenerate: () => void; loading: boolean }) {
  const set = <K extends keyof LineupFactoryConfig>(k: K, v: LineupFactoryConfig[K]) =>
    onChange({ ...cfg, [k]: v });

  const totalBudget = cfg.stakePerEntry * cfg.numEntries;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Format ── */}
      <Card className="bg-slate-900/60 border-slate-800">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider">Format</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Entry Type</Label>
            <ToggleGroup
              value={cfg.format}
              onChange={v => set("format", v as LineupFactoryConfig["format"])}
              options={[
                { label: "Power", value: "power" },
                { label: "Flex", value: "flex" },
                { label: "Stack", value: "stack" },
                { label: "Team+Player", value: "team_plus_player" },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Picks per entry</Label>
              <ToggleGroup
                value={cfg.picksPerEntry}
                onChange={v => set("picksPerEntry", Number(v))}
                options={[2, 3, 4, 5, 6].map(n => ({ label: String(n), value: n }))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Entries</Label>
              <ToggleGroup
                value={cfg.numEntries}
                onChange={v => set("numEntries", Number(v))}
                options={[1, 3, 5, 10, 25].map(n => ({ label: String(n), value: n }))}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">Stake per entry</Label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={5}
                  value={cfg.stakePerEntry}
                  onChange={e => set("stakePerEntry", Math.max(1, Number(e.target.value)))}
                  className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary"
                />
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Total budget</div>
              <div className="text-sm font-mono font-bold text-foreground">{dollars(totalBudget)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Strategy ── */}
      <Card className="bg-slate-900/60 border-slate-800">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider">Strategy</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Variance Profile</Label>
            <ToggleGroup
              value={cfg.varianceProfile}
              onChange={v => set("varianceProfile", v as LineupFactoryConfig["varianceProfile"])}
              options={Object.entries(PROFILE_LABELS).map(([k, v]) => ({ label: v.label, value: k as LineupFactoryConfig["varianceProfile"] }))}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Optimization Objective</Label>
            <Select value={cfg.optimizationObjective} onValueChange={v => set("optimizationObjective", v as LineupFactoryConfig["optimizationObjective"])}>
              <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-700 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OBJECTIVE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Simulation Iterations</Label>
            <ToggleGroup
              value={cfg.monteCarloIterations ?? 10000}
              onChange={v => set("monteCarloIterations", Number(v))}
              options={ITERATION_OPTIONS}
            />
            <p className="text-[10px] text-muted-foreground mt-1">More iterations = more accurate break-even/profit odds, slightly slower.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Exposure ── */}
      <Card className="bg-slate-900/60 border-slate-800">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider">Exposure Limits</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <ExposureSelect label="Max player exposure" value={cfg.maxPlayerExposure} onChange={v => set("maxPlayerExposure", v)} />
          <ExposureSelect label="Max pick exposure"   value={cfg.maxPickExposure}   onChange={v => set("maxPickExposure", v)} />
          <ExposureSelect label="Max team exposure"   value={cfg.maxTeamExposure}   onChange={v => set("maxTeamExposure", v)} />
          <ExposureSelect label="Max game exposure"   value={cfg.maxGameExposure}   onChange={v => set("maxGameExposure", v)} />
          <ExposureSelect label="Max lineup overlap"  value={cfg.maxPairwiseOverlap} onChange={v => set("maxPairwiseOverlap", v)} options={OVERLAP_OPTIONS} />
        </CardContent>
      </Card>

      {/* ── Filters ── */}
      <Card className="bg-slate-900/60 border-slate-800">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider">Filters</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {(
              [
                { key: "allowGtdPlayers",     label: "Allow GTD players" },
                { key: "allowSingleBookData", label: "Allow single-book data" },
                { key: "allowStaleMarketData", label: "Allow stale market data" },
                { key: "demonUnderAllowed",   label: "Allow Demon LESS" },
              ] as { key: keyof LineupFactoryConfig; label: string }[]
            ).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <Switch
                  checked={Boolean(cfg[key])}
                  onCheckedChange={v => set(key, v as LineupFactoryConfig[typeof key])}
                />
              </div>
            ))}
          </div>
          <Separator className="border-slate-800" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Min edge score</Label>
              <input
                type="number"
                placeholder="None"
                value={cfg.minEdgeThreshold ?? ""}
                onChange={e => set("minEdgeThreshold", e.target.value ? Number(e.target.value) : undefined)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Min hit prob</Label>
              <input
                type="number"
                placeholder="None"
                step="0.01"
                min="0"
                max="1"
                value={cfg.minProbabilityThreshold ?? ""}
                onChange={e => set("minProbabilityThreshold", e.target.value ? Number(e.target.value) : undefined)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Sport (optional)</Label>
            <Select value={cfg.sport ?? "all"} onValueChange={v => set("sport", v === "all" ? undefined : v)}>
              <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-700 w-full">
                <SelectValue placeholder="All Sports" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Sports</SelectItem>
                {["NBA", "NFL", "MLB", "NHL", "WNBA"].map(s => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={onGenerate}
        disabled={loading}
        className="w-full bg-primary hover:bg-primary/90 font-mono font-bold"
        size="lg"
      >
        {loading ? (
          <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Generating…</>
        ) : (
          <><Factory className="mr-2 h-4 w-4" />Generate Portfolio</>
        )}
      </Button>
    </div>
  );
}

// ─── Portfolio stats bar ──────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="bg-slate-900/60 border-slate-800 flex-1 min-w-0">
      <CardContent className="px-3 py-3">
        <div className="text-[10px] uppercase font-mono text-muted-foreground tracking-wider mb-1">{label}</div>
        <div className={cn("text-lg font-bold font-mono", color ?? "text-foreground")}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function PortfolioStatsBar({ stats, numLineups }: { stats: PortfolioStats; numLineups: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatCard label="Total Stake"    value={dollars(stats.totalStake)} />
      <StatCard
        label="Portfolio EV"
        value={sign(stats.portfolioEV)}
        color={stats.portfolioEV >= 0 ? "text-emerald-400" : "text-red-400"}
        sub={`Per entry: ${sign(stats.portfolioEV / Math.max(numLineups, 1))}`}
      />
      <StatCard
        label="≥1 Cashes"
        value={pct(stats.probAtLeastOneCashes)}
        color="text-blue-400"
      />
      <StatCard
        label="Profitable"
        value={pct(stats.probProfitable)}
        sub={`Break-even: ${pct(stats.probBreakEven)}`}
        color={stats.probProfitable > 0.5 ? "text-emerald-400" : "text-amber-400"}
      />
      <StatCard
        label="Max Payout"
        value={dollars(stats.maxPayout)}
        sub={`Worst: -${dollars(-stats.worstCaseLoss)}`}
        color="text-purple-400"
      />
      <StatCard
        label="Avg Overlap"
        value={pct(stats.avgPairwiseOverlap)}
        sub="Between lineups"
        color={stats.avgPairwiseOverlap > 0.50 ? "text-amber-400" : "text-emerald-400"}
      />
    </div>
  );
}

// ─── Line-type badge ──────────────────────────────────────────────────────────
function LineTypeBadge({ t }: { t: string }) {
  if (t === "goblin") return <Badge className="text-[9px] px-1 py-0 bg-emerald-900/60 text-emerald-400 border-emerald-800/50">goblin</Badge>;
  if (t === "demon")  return <Badge className="text-[9px] px-1 py-0 bg-red-900/60 text-red-400 border-red-800/50">demon</Badge>;
  return null;
}

// ─── Confidence badge ────────────────────────────────────────────────────────
function ConfidenceDot({ c }: { c: string }) {
  const colors: Record<string, string> = { high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-slate-500" };
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", colors[c] ?? "bg-slate-500")} title={`${c} confidence`} />;
}

// ─── Single lineup card ───────────────────────────────────────────────────────
function LineupCard({ lineup, index, onLoad }: { lineup: GeneratedLineup; index: number; onLoad: (lu: GeneratedLineup) => void }) {
  const evColor = lineup.ev >= 0 ? "text-emerald-400" : "text-red-400";
  const corrBg = lineup.correlationAdjusted ? "border-amber-700/40" : "border-slate-800";

  return (
    <Card className={cn("bg-slate-900/60", corrBg)}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-muted-foreground">#{index + 1}</span>
            <Badge variant="outline" className={cn("font-mono text-xs", evColor)}>
              EV {sign(lineup.ev)}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs text-blue-400 border-blue-800/50">
              {pct(lineup.hitProbability)} hit
            </Badge>
            <Badge variant="outline" className="font-mono text-xs text-purple-400 border-purple-800/50">
              {dollars(lineup.grossPayout)} payout
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            {lineup.diversificationScore !== undefined && (
              <span className="text-[10px] font-mono text-muted-foreground" title="Diversification score">
                div {pct(lineup.diversificationScore)}
              </span>
            )}
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 font-mono border-slate-700" onClick={() => onLoad(lineup)}>
              Load to Entry
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-1">
        {lineup.picks.map((pick, pi) => (
          <div key={pi} className="flex items-center gap-2 text-xs py-0.5">
            <PlayerAvatar name={pick.playerName} imageUrl={pick.imageUrl ?? null} size="xs" />
            <span className="font-medium truncate flex-1 min-w-0">{pick.playerName}</span>
            <span className="text-muted-foreground shrink-0">{pick.statType}</span>
            <span className="font-mono text-foreground shrink-0">{pick.ppLine}</span>
            <span className={cn("font-mono text-xs shrink-0 uppercase", pick.direction === "more" ? "text-emerald-400" : "text-red-400")}>
              {pick.direction === "more" ? "▲" : "▼"} {pct(pick.hitProbability)}
            </span>
            {pick.lineType !== "standard" && pick.payoutMultiplier != null && pick.payoutMultiplier !== 1 && (
              <span className={cn("font-mono text-[10px] shrink-0", pick.payoutMultiplier > 1 ? "text-rose-400" : "text-emerald-400")}>
                ×{pick.payoutMultiplier.toFixed(2)}
              </span>
            )}
            <LineTypeBadge t={pick.lineType} />
          </div>
        ))}
        {lineup.correlationNote && (
          <div className="flex items-start gap-1.5 mt-2 text-[10px] text-amber-400/80">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{lineup.correlationNote}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Scored props table ───────────────────────────────────────────────────────
function ScoredPropsTable({ props }: { props: FactoryScoredProp[] }) {
  const [filter, setFilter] = useState<"all" | "eligible" | "excluded">("all");
  const displayed = props.filter(p => {
    if (filter === "eligible") return !p.noPlayReason;
    if (filter === "excluded") return !!p.noPlayReason;
    return true;
  }).slice(0, 100);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ToggleGroup
          value={filter}
          onChange={v => setFilter(v as "all" | "eligible" | "excluded")}
          options={[
            { label: "All", value: "all" },
            { label: "Eligible", value: "eligible" },
            { label: "Excluded", value: "excluded" },
          ]}
        />
        <span className="text-xs text-muted-foreground ml-2">Showing {displayed.length} of {props.length}</span>
      </div>
      <div className="overflow-auto max-h-[520px] rounded border border-slate-800">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800">
              <TableHead className="text-xs text-muted-foreground">Player</TableHead>
              <TableHead className="text-xs text-muted-foreground">Stat</TableHead>
              <TableHead className="text-xs text-muted-foreground">Line</TableHead>
              <TableHead className="text-xs text-muted-foreground">Hit Prob</TableHead>
              <TableHead className="text-xs text-muted-foreground">Source</TableHead>
              <TableHead className="text-xs text-muted-foreground">EV</TableHead>
              <TableHead className="text-xs text-muted-foreground">Edge</TableHead>
              <TableHead className="text-xs text-muted-foreground">Vol</TableHead>
              <TableHead className="text-xs text-muted-foreground">Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map(p => (
              <TableRow
                key={p.ppLineId}
                className={cn(
                  "border-slate-800/60 hover:bg-slate-800/30",
                  p.noPlayReason ? "opacity-50" : "",
                )}
              >
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-1.5">
                    <PlayerAvatar name={p.playerName} imageUrl={p.imageUrl ?? null} size="xs" />
                    <span className="text-xs font-medium truncate max-w-[120px]">{p.playerName}</span>
                  </div>
                </TableCell>
                <TableCell className="py-1.5 text-xs text-muted-foreground">{p.statType}</TableCell>
                <TableCell className="py-1.5 text-xs font-mono">
                  {p.ppLine}
                  {p.lineType !== "standard" && <LineTypeBadge t={p.lineType} />}
                  {p.lineType !== "standard" && p.payoutMultiplier != null && p.payoutMultiplier !== 1 && (
                    <span className={cn("ml-1 text-[10px]", p.payoutMultiplier > 1 ? "text-rose-400" : "text-emerald-400")}>
                      ×{p.payoutMultiplier.toFixed(2)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-xs font-mono">
                  <div className="flex items-center gap-1">
                    <ConfidenceDot c={p.confidence} />
                    <span className={p.hitProbability >= 0.55 ? "text-emerald-400" : p.hitProbability >= 0.45 ? "text-foreground" : "text-red-400"}>
                      {pct(p.hitProbability)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-1.5">
                  <span className="text-[9px] font-mono text-muted-foreground uppercase">{p.probabilitySource}</span>
                </TableCell>
                <TableCell className={cn("py-1.5 text-xs font-mono", p.expectedValue >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {sign(p.expectedValue)}
                </TableCell>
                <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">
                  {p.edgeScore != null ? p.edgeScore.toFixed(1) : "—"}
                </TableCell>
                <TableCell className="py-1.5 text-xs">
                  {p.volatilityRating === "high"   && <span className="text-red-400">↑</span>}
                  {p.volatilityRating === "medium" && <span className="text-amber-400">~</span>}
                  {p.volatilityRating === "low"    && <span className="text-emerald-400">↓</span>}
                  {!p.volatilityRating             && <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="flex gap-1 flex-wrap">
                    {p.noPlayReason && (
                      <Badge className="text-[8px] px-1 py-0 bg-red-900/40 text-red-400 border-red-800/50">
                        {p.noPlayReason.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {p.reasonCodes.filter(r => r !== "no_play").slice(0, 2).map(r => (
                      <Badge key={r} className="text-[8px] px-1 py-0 bg-slate-800 text-muted-foreground border-slate-700">
                        {r.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Exposure heatmap ─────────────────────────────────────────────────────────
function ExposurePanel({ stats }: { stats: PortfolioStats }) {
  const top = stats.topPicksByExposure as { name: string; exposure: number }[];
  return (
    <div className="space-y-1.5">
      {top.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-4 shrink-0 text-right font-mono text-muted-foreground">{i + 1}</div>
          <div className="flex-1 min-w-0">
            <div className="text-foreground truncate">{item.name}</div>
            <div
              className="h-1 rounded-full mt-0.5 bg-primary/60"
              style={{ width: `${Math.round(item.exposure * 100)}%` }}
            />
          </div>
          <div className="font-mono text-muted-foreground shrink-0">{pct(item.exposure)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty / loading states ───────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center gap-3">
      <Factory className="h-12 w-12 text-muted-foreground/30" />
      <div>
        <div className="text-sm font-medium text-foreground mb-1">Lineup Factory</div>
        <div className="text-xs text-muted-foreground max-w-xs">
          Configure your portfolio parameters on the left and click <strong>Generate Portfolio</strong> to build a set of diversified lineups.
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground font-mono max-w-xs mt-2">
        {["Exposure control", "Correlation-adjusted EV", "Portfolio analytics", "Monte Carlo P(profit)", "Pick diversification", "Scored prop table"].map(f => (
          <div key={f} className="flex items-center gap-1 text-left">
            <CheckCircle2 className="h-2.5 w-2.5 text-primary shrink-0" />
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LineupFactory() {
  const [cfg, setCfg] = useState<LineupFactoryConfig>(DEFAULTS);
  const generate = useGenerateLineupFactory();
  const { addPick } = useEntry();
  const result = generate.data;

  function handleGenerate() {
    generate.mutate({ data: cfg });
  }

  function handleLoadLineup(lineup: GeneratedLineup) {
    for (const pick of lineup.picks) {
      addPick({
        ppLineId:       pick.ppLineId,
        playerId:       pick.playerId,
        playerName:     pick.playerName,
        imageUrl:       pick.imageUrl ?? null,
        teamAbbr:       null,
        statType:       pick.statType,
        lineValue:      pick.ppLine,
        lineType:       pick.lineType,
        direction:      pick.direction as "more" | "less",
        yourProjection: null,
        p99:            null,
        pOver:          null,
        edgeScore:      pick.edgeScore ?? null,
        actionTag:      null,
      });
    }
  }

  const profileInfo = PROFILE_LABELS[cfg.varianceProfile];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Factory className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold font-mono">Lineup Factory</h1>
          <p className="text-xs text-muted-foreground">Portfolio construction — risk-adjusted, diversified, correlation-aware</p>
        </div>
        {result && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <span>{result.filteredPropCount} eligible</span>
            <ChevronRight className="h-3 w-3" />
            <span>{result.lineups.length} lineups</span>
            <ChevronRight className="h-3 w-3" />
            <span className={cn(profileInfo.color)}>{profileInfo.label}</span>
          </div>
        )}
      </div>

      {/* ── Two-column layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Config panel — scrollable */}
        <div className="w-72 shrink-0 border-r border-border/50 overflow-y-auto p-4">
          <ConfigPanel cfg={cfg} onChange={setCfg} onGenerate={handleGenerate} loading={generate.isPending} />
        </div>

        {/* Results panel — scrollable */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          {generate.isPending && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3">
              <RefreshCw className="h-8 w-8 text-primary animate-spin" />
              <div className="text-sm text-muted-foreground font-mono">Scoring props and generating portfolio…</div>
            </div>
          )}

          {generate.isError && !generate.isPending && (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2">
              <AlertTriangle className="h-8 w-8 text-red-400" />
              <div className="text-sm text-red-400 font-mono">Generation failed. Check filters — pool may be too small.</div>
              <Button variant="outline" size="sm" onClick={handleGenerate} className="mt-2 font-mono">
                Retry
              </Button>
            </div>
          )}

          {!result && !generate.isPending && !generate.isError && <EmptyState />}

          {result && !generate.isPending && (
            <div className="space-y-5">
              {/* Portfolio stats */}
              <PortfolioStatsBar stats={result.portfolioStats} numLineups={result.lineups.length} />

              {/* Tabs: Lineups / Scored Props / Exposure */}
              <Tabs defaultValue="lineups">
                <TabsList className="bg-slate-900 border border-slate-800">
                  <TabsTrigger value="lineups" className="text-xs font-mono data-[state=active]:bg-slate-800">
                    <BarChart2 className="h-3 w-3 mr-1.5" />
                    Lineups ({result.lineups.length})
                  </TabsTrigger>
                  <TabsTrigger value="props" className="text-xs font-mono data-[state=active]:bg-slate-800">
                    <TrendingUp className="h-3 w-3 mr-1.5" />
                    Scored Props ({result.scoredProps.length})
                  </TabsTrigger>
                  <TabsTrigger value="exposure" className="text-xs font-mono data-[state=active]:bg-slate-800">
                    <DollarSign className="h-3 w-3 mr-1.5" />
                    Exposure
                  </TabsTrigger>
                </TabsList>

                {/* Lineups grid */}
                <TabsContent value="lineups" className="mt-4">
                  {result.lineups.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <AlertTriangle className="h-6 w-6 text-amber-400" />
                      <div className="text-sm text-muted-foreground">
                        No lineups could be generated. Try relaxing filters or increasing the eligible prop pool.
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {result.lineups.map((lu, i) => (
                        <LineupCard key={lu.id} lineup={lu} index={i} onLoad={handleLoadLineup} />
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Scored props */}
                <TabsContent value="props" className="mt-4">
                  <ScoredPropsTable props={result.scoredProps} />
                </TabsContent>

                {/* Exposure */}
                <TabsContent value="exposure" className="mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card className="bg-slate-900/60 border-slate-800">
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider">
                          Top Picks by Exposure
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <ExposurePanel stats={result.portfolioStats} />
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-900/60 border-slate-800">
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider">
                          Portfolio Risk Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Avg pairwise overlap</span>
                          <span className={cn("font-mono", result.portfolioStats.avgPairwiseOverlap > 0.5 ? "text-amber-400" : "text-emerald-400")}>
                            {pct(result.portfolioStats.avgPairwiseOverlap)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Worst case loss</span>
                          <span className="font-mono text-red-400">{dollars(result.portfolioStats.worstCaseLoss)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max payout</span>
                          <span className="font-mono text-purple-400">{dollars(result.portfolioStats.maxPayout)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Return on stake (EV)</span>
                          <span className={cn("font-mono", result.portfolioStats.portfolioEV >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {result.portfolioStats.totalStake > 0
                              ? `${((result.portfolioStats.portfolioEV / result.portfolioStats.totalStake) * 100).toFixed(1)}%`
                              : "—"}
                          </span>
                        </div>
                        <Separator className="border-slate-800 my-2" />
                        <div className="text-[10px] text-muted-foreground leading-relaxed">
                          <strong className="text-foreground">Note:</strong> EV estimates use available market + projection data.
                          Probabilities labeled by source and confidence.
                          Correlation adjustments applied where same-player or same-game picks are detected.
                          Monte Carlo ({(4000).toLocaleString()} runs) used for P(profit).
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
