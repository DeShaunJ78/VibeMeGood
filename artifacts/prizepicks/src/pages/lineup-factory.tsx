import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGenerateLineupFactory,
  type LineupFactoryConfig,
  type GeneratedLineup,
  type FactoryScoredProp,
  type PortfolioStats,
  type LineupFactoryResult,
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
  readPinnedPicks, removePinnedPick, clearPinnedPicks, type PinnedPick,
} from "@/lib/pinned-picks";
import {
  readSavedLineups, appendSavedLineup, updateSavedLineupLabel, deleteSavedLineup,
  type SavedLineup,
} from "@/lib/saved-lineups";
import {
  Factory, Zap, TrendingUp, DollarSign, AlertTriangle,
  ChevronRight, BarChart2, RefreshCw, CheckCircle2, Info, Pin, X, Lock, LockOpen,
  History, Pencil, Check, Trash2, Clock, ArrowLeftRight, Trophy,
} from "lucide-react";
import {
  type LineupFactoryConfigGppNarrativeFilters,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// ─── Persistence helpers ───────────────────────────────────────────────────────
const CFG_KEY      = "lf_cfg";
const CFG_VER      = 3;
const RESULT_KEY   = "lf_last_result";
const RESULT_TTL   = 24 * 60 * 60 * 1000;
const REQUIRED_KEY = "lf_required_pinned_ids";

function loadCfg(): LineupFactoryConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return DEFAULTS;
    const { v, data } = JSON.parse(raw) as { v: number; data: LineupFactoryConfig };
    if (v !== CFG_VER) return DEFAULTS;
    return { ...DEFAULTS, ...data };
  } catch {
    return DEFAULTS;
  }
}

function saveCfg(cfg: LineupFactoryConfig): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify({ v: CFG_VER, data: cfg }));
  } catch {}
}

function loadRequiredIds(): Set<number> {
  try {
    const s = localStorage.getItem(REQUIRED_KEY);
    if (!s) return new Set();
    const arr = JSON.parse(s) as unknown;
    return new Set(Array.isArray(arr) ? (arr as number[]) : []);
  } catch {
    return new Set();
  }
}

function saveRequiredIds(ids: Set<number>): void {
  try {
    localStorage.setItem(REQUIRED_KEY, JSON.stringify([...ids]));
  } catch {}
}

function loadResult(): LineupFactoryResult | null {
  try {
    const raw = localStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: LineupFactoryResult };
    if (Date.now() - ts > RESULT_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function saveResult(result: LineupFactoryResult): void {
  try {
    localStorage.setItem(RESULT_KEY, JSON.stringify({ ts: Date.now(), data: result }));
  } catch {}
}

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
  biasWeight: 0,
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
  gpp_mode:        "GPP — Tournament Mode",
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

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
            <Select value={cfg.optimizationObjective} onValueChange={v => {
              const obj = v as LineupFactoryConfig["optimizationObjective"];
              onChange({ ...cfg, optimizationObjective: obj, gppNarrativeFilters: obj === "gpp_mode" ? (cfg.gppNarrativeFilters ?? {}) : undefined });
            }}>
              <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-700 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OBJECTIVE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* GPP quick-preset */}
            {cfg.optimizationObjective !== "gpp_mode" && (
              <button
                onClick={() => onChange({
                  ...cfg,
                  optimizationObjective: "gpp_mode",
                  varianceProfile: "aggressive",
                  maxPlayerExposure: 0.30,
                  maxPickExposure: 0.30,
                  gppNarrativeFilters: {},
                })}
                className="mt-1.5 flex items-center gap-1.5 text-[10px] font-mono text-amber-400/70 hover:text-amber-400 transition-colors"
              >
                <Trophy className="w-2.5 h-2.5" />
                GPP Preset (low-owned, ceiling-first)
              </button>
            )}
          </div>
          {/* GPP Narrative Filters — shown only when gpp_mode is selected */}
          {cfg.optimizationObjective === "gpp_mode" && (
            <div className="rounded border border-amber-800/40 bg-amber-950/20 px-3 py-3 space-y-3">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Trophy className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] uppercase tracking-wider font-mono text-amber-400 font-semibold">GPP Narrative Filters</span>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Pace preference</Label>
                <ToggleGroup
                  value={(cfg.gppNarrativeFilters?.pacePreference ?? "any") as string}
                  onChange={v => onChange({ ...cfg, gppNarrativeFilters: { ...cfg.gppNarrativeFilters, pacePreference: v === "any" ? undefined : v as LineupFactoryConfigGppNarrativeFilters["pacePreference"] } })}
                  options={[
                    { label: "Any",     value: "any" },
                    { label: "Fast",    value: "fast" },
                    { label: "Neutral", value: "neutral" },
                  ]}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Min game total</Label>
                <input
                  type="number"
                  placeholder="None"
                  step="0.5"
                  min="0"
                  value={cfg.gppNarrativeFilters?.minGameTotal ?? ""}
                  onChange={e => onChange({ ...cfg, gppNarrativeFilters: { ...cfg.gppNarrativeFilters, minGameTotal: e.target.value ? Number(e.target.value) : undefined } })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-amber-600"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Only include props from games above this total (e.g. 220 for NBA)</p>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Sharp alignment only</Label>
                <Switch
                  checked={cfg.gppNarrativeFilters?.sharpAlignmentOnly ?? false}
                  onCheckedChange={v => onChange({ ...cfg, gppNarrativeFilters: { ...cfg.gppNarrativeFilters, sharpAlignmentOnly: v } })}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Excludes picks where sharp money moved against your direction.</p>
            </div>
          )}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Simulation Iterations</Label>
            <ToggleGroup
              value={cfg.monteCarloIterations ?? 10000}
              onChange={v => set("monteCarloIterations", Number(v))}
              options={ITERATION_OPTIONS}
            />
            <p className="text-[10px] text-muted-foreground mt-1">More iterations = more accurate break-even/profit odds, slightly slower.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Bias Weight
              {(cfg.biasWeight ?? 0) > 0 && (
                <span className="ml-1.5 text-[9px] text-amber-400 uppercase tracking-wider font-bold">active</span>
              )}
            </Label>
            <ToggleGroup
              value={cfg.biasWeight ?? 0}
              onChange={v => set("biasWeight", Number(v))}
              options={[
                { label: "Off",  value: 0    },
                { label: "Low",  value: 0.25 },
                { label: "Med",  value: 0.5  },
                { label: "High", value: 1.0  },
              ]}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Nudges picks up/down based on your historical edge vs the model. Applied at generation time.
            </p>
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
function LineupCard({ lineup, index, onLoad, isGppMode, propsMap }: {
  lineup: GeneratedLineup;
  index: number;
  onLoad: (lu: GeneratedLineup) => void;
  isGppMode?: boolean;
  propsMap?: Map<number, FactoryScoredProp>;
}) {
  const evColor = lineup.ev >= 0 ? "text-emerald-400" : "text-red-400";
  const corrBg = lineup.correlationAdjusted
    ? "border-amber-700/40"
    : isGppMode
      ? "border-amber-800/30"
      : "border-slate-800";

  // For GPP: compute avg leverage across picks
  const avgLeverage = isGppMode && propsMap
    ? (() => {
        const scores = lineup.picks.map(p => propsMap.get(p.ppLineId)?.leverageScore ?? null).filter((v): v is number => v !== null);
        return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      })()
    : null;

  return (
    <Card className={cn("bg-slate-900/60", corrBg, isGppMode && "bg-amber-950/10")}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-muted-foreground">#{index + 1}</span>
            {isGppMode && (
              <Badge className="text-[8px] px-1.5 py-0 bg-amber-900/50 text-amber-300 border-amber-700/50 font-mono">
                <Trophy className="w-2 h-2 mr-0.5 inline" />GPP
              </Badge>
            )}
            {isGppMode && avgLeverage !== null && (
              <Badge variant="outline" className="font-mono text-xs text-amber-400 border-amber-800/50">
                lev {avgLeverage.toFixed(0)}
              </Badge>
            )}
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
        {lineup.picks.map((pick, pi) => {
          const sp = propsMap?.get(pick.ppLineId);
          return (
          <div key={pi} className="flex items-center gap-2 text-xs py-0.5">
            <PlayerAvatar name={pick.playerName} imageUrl={pick.imageUrl ?? null} size="xs" />
            <span className="font-medium truncate flex-1 min-w-0">{pick.playerName}</span>
            <span className="text-muted-foreground shrink-0">{pick.statType}</span>
            <span className="font-mono text-foreground shrink-0">{pick.ppLine}</span>
            <span className={cn("font-mono text-xs shrink-0 uppercase", pick.direction === "more" ? "text-emerald-400" : "text-red-400")}>
              {pick.direction === "more" ? "▲" : "▼"} {pct(pick.hitProbability)}
            </span>
            {isGppMode && sp && (
              <span
                className={cn("font-mono text-[10px] shrink-0", sp.ownershipSource === "real" ? "text-cyan-400/90" : "text-amber-400/80")}
                title={`${sp.ownershipSource === "real" ? "Live" : "Est."} ownership ${sp.ownershipEst?.toFixed(1)}% / Lev ${sp.leverageScore?.toFixed(0)}`}
              >
                {sp.ownershipEst != null ? `${sp.ownershipEst.toFixed(0)}%own${sp.ownershipSource === "real" ? "★" : ""}` : ""}
              </span>
            )}
            {pick.lineType !== "standard" && pick.payoutMultiplier != null && pick.payoutMultiplier !== 1 && (
              <span className={cn("font-mono text-[10px] shrink-0", pick.payoutMultiplier > 1 ? "text-rose-400" : "text-emerald-400")}>
                ×{pick.payoutMultiplier.toFixed(2)}
              </span>
            )}
            <LineTypeBadge t={pick.lineType} />
          </div>
          );
        })}
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

// ─── GPP badges ──────────────────────────────────────────────────────────────
function PaceBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  if (tier === "fast")   return <span className="text-[8px] font-mono px-1 py-px rounded bg-emerald-900/50 text-emerald-400 border border-emerald-800/40">⚡fast</span>;
  if (tier === "slow")   return <span className="text-[8px] font-mono px-1 py-px rounded bg-slate-800 text-slate-400 border border-slate-700">🐢slow</span>;
  return null;
}
function SharpBadge({ signal }: { signal: string | null | undefined }) {
  if (!signal) return null;
  if (signal === "sharp_for")     return <span className="text-[8px] font-mono px-1 py-px rounded bg-blue-900/50 text-blue-300 border border-blue-800/40">♦ sharp↑</span>;
  if (signal === "sharp_against") return <span className="text-[8px] font-mono px-1 py-px rounded bg-red-900/50 text-red-400 border border-red-800/40">✖ sharp↓</span>;
  if (signal === "public")        return <span className="text-[8px] font-mono px-1 py-px rounded bg-amber-900/50 text-amber-400 border border-amber-800/40">👥 public</span>;
  return null;
}

// ─── Scored props table ───────────────────────────────────────────────────────
function ScoredPropsTable({ props, pinnedIds, biasWeight, isGppMode }: {
  props: FactoryScoredProp[];
  pinnedIds: Set<number>;
  biasWeight: number;
  isGppMode?: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "eligible" | "excluded">("all");

  // Share bias cache with Slate Board via same queryKey → zero extra network requests
  const { data: biasRaw } = useQuery({
    queryKey: ["stat-bias"],
    queryFn: async () => {
      const b = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const r = await fetch(`${b}/api/dashboard/stat-bias`);
      if (!r.ok) return { buckets: [] };
      return r.json() as Promise<{
        buckets: Array<{ sport: string | null; statType: string; tier: string; delta: number | null; hasEnoughData: boolean }>;
      }>;
    },
    staleTime: 60_000,
  });

  // Mirrors Slate Board: key = "sport|statType|tier" for O(1) per-row lookup
  const biasDeltaMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const bkt of biasRaw?.buckets ?? []) {
      if (bkt.hasEnoughData && bkt.delta != null) {
        m.set(`${bkt.sport ?? ""}|${bkt.statType}|${bkt.tier}`, bkt.delta);
      }
    }
    return m;
  }, [biasRaw]);

  // Resolve bias delta with fallback chain:
  //   exact (sport|statType|tier) → standard tier → sport-agnostic tier → sport-agnostic standard
  function getBias(p: FactoryScoredProp): number | null {
    return (
      biasDeltaMap.get(`${p.sport}|${p.statType}|${p.lineType}`) ??
      biasDeltaMap.get(`${p.sport}|${p.statType}|standard`) ??
      biasDeltaMap.get(`|${p.statType}|${p.lineType}`) ??
      biasDeltaMap.get(`|${p.statType}|standard`) ??
      null
    );
  }

  const filtered = props.filter(p => {
    if (filter === "eligible") return !p.noPlayReason;
    if (filter === "excluded") return !!p.noPlayReason;
    return true;
  });

  // When biasWeight > 0 or isGppMode, re-sort appropriately
  const sorted = useMemo(() => {
    const pinned = filtered.filter(p => pinnedIds.has(p.ppLineId));
    const rest   = filtered.filter(p => !pinnedIds.has(p.ppLineId));
    if (isGppMode) {
      // GPP: sort by leverage score descending (ceiling/ownership)
      const byLev = (a: FactoryScoredProp, b: FactoryScoredProp) => (b.leverageScore ?? 0) - (a.leverageScore ?? 0);
      return [...pinned.slice().sort(byLev), ...rest.slice().sort(byLev)];
    }
    if (biasWeight === 0) return [...pinned, ...rest];
    const adj = (p: FactoryScoredProp) => {
      const bd = biasDeltaMap.get(`${p.sport}|${p.statType}|${p.lineType}`)
        ?? biasDeltaMap.get(`${p.sport}|${p.statType}|standard`)
        ?? biasDeltaMap.get(`|${p.statType}|${p.lineType}`)
        ?? biasDeltaMap.get(`|${p.statType}|standard`)
        ?? 0;
      return p.compositeScore + biasWeight * bd;
    };
    return [
      ...pinned.slice().sort((a, b) => adj(b) - adj(a)),
      ...rest.slice().sort((a, b) => adj(b) - adj(a)),
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, pinnedIds, biasWeight, biasDeltaMap, isGppMode]);

  const displayed = sorted.slice(0, 100);
  const biasActive = biasWeight > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
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
        {biasActive && (
          <span className="ml-auto text-[9px] font-mono text-amber-400 uppercase tracking-wider shrink-0">bias-adj</span>
        )}
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
              {isGppMode ? (
                <>
                  <TableHead className="text-xs text-amber-400">Own%</TableHead>
                  <TableHead className="text-xs text-amber-400">Leverage ↕</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Context</TableHead>
                </>
              ) : (
                <>
                  <TableHead className="text-xs text-muted-foreground">
                    {biasActive ? <span className="text-amber-400">Bias ↕</span> : "Bias"}
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground">Vol</TableHead>
                </>
              )}
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
                    {pinnedIds.has(p.ppLineId) && (
                      <span title="Pinned from Slate Board">
                        <Pin className="w-2.5 h-2.5 text-primary shrink-0 fill-primary" />
                      </span>
                    )}
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
                {isGppMode ? (
                  <>
                    <TableCell className="py-1.5 text-xs font-mono">
                      <span className={cn(
                        p.ownershipSource === "real"
                          ? "text-cyan-400"
                          : (p.ownershipEst ?? 20) <= 10 ? "text-emerald-400" :
                            (p.ownershipEst ?? 20) <= 20 ? "text-foreground" : "text-amber-400",
                      )} title={p.ownershipSource === "real" ? "Live crowd ownership %" : "Estimated ownership %"}>
                        {p.ownershipEst != null ? `${p.ownershipEst.toFixed(1)}%${p.ownershipSource === "real" ? "★" : ""}` : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 text-xs font-mono">
                      <span className={cn(
                        (p.leverageScore ?? 0) >= 200 ? "text-amber-300 font-bold" :
                        (p.leverageScore ?? 0) >= 100 ? "text-amber-400" : "text-muted-foreground",
                      )}>
                        {p.leverageScore != null ? p.leverageScore.toFixed(0) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex gap-1 flex-wrap items-center">
                        <PaceBadge tier={p.paceTier} />
                        <SharpBadge signal={p.sharpSignal} />
                        {p.gameTotal != null && (
                          <span className="text-[8px] font-mono text-muted-foreground">tot:{p.gameTotal}</span>
                        )}
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="py-1.5 text-xs font-mono">
                      {(() => {
                        const bd = getBias(p);
                        if (bd == null) return <span className="text-muted-foreground/40">—</span>;
                        return (
                          <span
                            className={bd >= 0 ? "text-emerald-400" : "text-rose-400"}
                            title={`Personal bias: ${bd >= 0 ? "+" : ""}${bd.toFixed(1)}pp on ${p.sport} ${p.statType} (${p.lineType})`}
                          >
                            {bd >= 0 ? "+" : ""}{bd.toFixed(1)}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">
                      {p.volatilityRating === "high"   && <span className="text-red-400">↑</span>}
                      {p.volatilityRating === "medium" && <span className="text-amber-400">~</span>}
                      {p.volatilityRating === "low"    && <span className="text-emerald-400">↓</span>}
                      {!p.volatilityRating             && <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </>
                )}
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

// ─── Pinned picks panel ───────────────────────────────────────────────────────
function PinnedPanel({
  picks, requiredIds, picksPerEntry, onRemove, onClear, onToggleRequired,
  lockedCoverage, totalLineups,
}: {
  picks: PinnedPick[];
  requiredIds: Set<number>;
  picksPerEntry: number;
  onRemove: (id: number) => void;
  onClear: () => void;
  onToggleRequired: (id: number) => void;
  lockedCoverage?: Map<number, number>;
  totalLineups?: number;
}) {
  if (picks.length === 0) return null;
  const requiredCount = picks.filter(p => requiredIds.has(p.ppLineId)).length;
  const overLimit = requiredCount > picksPerEntry;

  const lockedSports = new Set(picks.filter(p => requiredIds.has(p.ppLineId)).map(p => p.sport));
  const mixedSports = lockedSports.size > 1;

  return (
    <Card className="bg-primary/5 border-primary/30">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs uppercase font-mono text-primary tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Pin className="w-3 h-3" />
            Pinned from Slate Board ({picks.length})
          </span>
          <button
            onClick={onClear}
            className="text-[10px] font-mono text-muted-foreground hover:text-rose-400 transition-colors"
          >
            Clear all
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        <p className="text-[10px] text-muted-foreground font-mono">
          Click <Lock className="inline w-2.5 h-2.5 mb-0.5" /> to lock a pick — locked picks appear in every generated lineup.
        </p>
        {overLimit && (
          <div className="flex items-start gap-1.5 rounded bg-amber-950/40 border border-amber-700/40 px-2 py-1.5 text-[10px] text-amber-400 font-mono">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              {requiredCount} locked picks exceed the {picksPerEntry}-pick limit. Only the top {picksPerEntry} (by score) will be used per lineup.
            </span>
          </div>
        )}
        {mixedSports && (
          <div className="flex items-start gap-1.5 rounded bg-slate-800/80 border border-slate-600/50 px-2 py-1.5 text-[10px] text-slate-400 font-mono">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
            <span>
              Locked picks span multiple sports ({[...lockedSports].join(", ")}). Each lineup will only include picks from one sport — set the sport filter above to control which.
            </span>
          </div>
        )}
        <div className="space-y-1">
          {picks.map(p => {
            const isRequired = requiredIds.has(p.ppLineId);
            return (
              <div
                key={p.ppLineId}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-mono border transition-colors",
                  isRequired
                    ? "bg-primary/10 border-primary/40 text-foreground"
                    : "bg-slate-800 border-primary/20 text-foreground",
                )}
              >
                <button
                  onClick={() => onToggleRequired(p.ppLineId)}
                  title={isRequired ? "Unlock — remove from required" : "Lock — require in every lineup"}
                  className={cn(
                    "shrink-0 transition-colors",
                    isRequired ? "text-primary hover:text-primary/70" : "text-slate-500 hover:text-primary",
                  )}
                >
                  {isRequired ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
                </button>
                <span className="font-medium truncate flex-1 min-w-0">{p.playerName}</span>
                <span className="text-muted-foreground shrink-0">{p.statType}</span>
                <span className="text-slate-500 shrink-0">{p.lineValue}</span>
                {isRequired && (
                  <span className="text-[8px] uppercase tracking-wider text-primary font-bold shrink-0">locked</span>
                )}
                {isRequired && lockedCoverage !== undefined && totalLineups !== undefined && totalLineups > 0 && (
                  (() => {
                    const count = lockedCoverage.get(p.ppLineId) ?? 0;
                    const full = count === totalLineups;
                    return (
                      <span className={cn(
                        "text-[8px] font-mono shrink-0 px-1 py-0.5 rounded",
                        full ? "bg-emerald-950/60 text-emerald-400 border border-emerald-700/40"
                             : "bg-amber-950/60 text-amber-400 border border-amber-700/40",
                      )}>
                        {count}/{totalLineups}
                      </span>
                    );
                  })()
                )}
                <button
                  onClick={() => onRemove(p.ppLineId)}
                  className="shrink-0 text-slate-600 hover:text-rose-400 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── CompareView ─────────────────────────────────────────────────────────────
function CompareView({
  runA,
  runB,
  onClose,
}: {
  runA: SavedLineup;
  runB: SavedLineup;
  onClose: () => void;
}) {
  const sA = runA.result.portfolioStats;
  const sB = runB.result.portfolioStats;

  // Collect unique picks from each run's lineups
  const pickInfoA = new Map<number, { playerName: string; statType: string; ppLine: number }>();
  const pickInfoB = new Map<number, { playerName: string; statType: string; ppLine: number }>();
  for (const lu of runA.result.lineups) {
    for (const p of lu.picks) {
      if (!pickInfoA.has(p.ppLineId)) pickInfoA.set(p.ppLineId, { playerName: p.playerName, statType: p.statType, ppLine: p.ppLine });
    }
  }
  for (const lu of runB.result.lineups) {
    for (const p of lu.picks) {
      if (!pickInfoB.has(p.ppLineId)) pickInfoB.set(p.ppLineId, { playerName: p.playerName, statType: p.statType, ppLine: p.ppLine });
    }
  }
  const picksA = new Set(pickInfoA.keys());
  const picksB = new Set(pickInfoB.keys());
  const sharedIds = [...picksA].filter(id => picksB.has(id));
  const onlyAIds  = [...picksA].filter(id => !picksB.has(id));
  const onlyBIds  = [...picksB].filter(id => !picksA.has(id));

  function win(a: number, b: number, higherIsBetter = true): "A" | "B" | "tie" {
    if (Math.abs(a - b) < 1e-9) return "tie";
    return (higherIsBetter ? a > b : a < b) ? "A" : "B";
  }

  const metrics: { label: string; a: string; b: string; w: "A" | "B" | "tie" }[] = [
    {
      label: "Portfolio EV",
      a: sign(sA.portfolioEV), b: sign(sB.portfolioEV),
      w: win(sA.portfolioEV, sB.portfolioEV),
    },
    {
      label: "P(Profit)",
      a: pct(sA.probProfitable), b: pct(sB.probProfitable),
      w: win(sA.probProfitable, sB.probProfitable),
    },
    {
      label: "P(≥1 cashes)",
      a: pct(sA.probAtLeastOneCashes), b: pct(sB.probAtLeastOneCashes),
      w: win(sA.probAtLeastOneCashes, sB.probAtLeastOneCashes),
    },
    {
      label: "Avg Overlap",
      a: pct(sA.avgPairwiseOverlap), b: pct(sB.avgPairwiseOverlap),
      w: win(sA.avgPairwiseOverlap, sB.avgPairwiseOverlap, false),
    },
    {
      label: "Total Stake",
      a: dollars(sA.totalStake), b: dollars(sB.totalStake),
      w: win(sA.totalStake, sB.totalStake, false),
    },
    {
      label: "Lineups",
      a: String(runA.result.lineups.length), b: String(runB.result.lineups.length),
      w: "tie",
    },
  ];

  const nameA = runA.label || runA.autoName;
  const nameB = runB.label || runB.autoName;

  function WinBadge({ side, w }: { side: "A" | "B"; w: "A" | "B" | "tie" }) {
    if (w === "tie" || w !== side) return null;
    return <span className="ml-1 text-[8px] text-emerald-400 font-bold">✓</span>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 rounded border border-slate-700/50 bg-slate-800/40 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-mono min-w-0">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-primary font-semibold truncate" title={nameA}>{nameA}</span>
          <span className="text-muted-foreground shrink-0">vs</span>
          <span className="text-amber-400 font-semibold truncate" title={nameB}>{nameB}</span>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded hover:bg-slate-700 text-muted-foreground hover:text-foreground transition-colors"
          title="Exit comparison"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Stat table */}
      <Card className="bg-slate-900/60 border-slate-800">
        <CardContent className="px-0 pb-0">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-2 text-muted-foreground font-normal text-[10px] uppercase tracking-wider w-1/3">Metric</th>
                <th className="text-right px-4 py-2 text-primary font-semibold text-[10px] w-1/3 truncate" title={nameA}>A · {nameA}</th>
                <th className="text-right px-4 py-2 text-amber-400 font-semibold text-[10px] w-1/3 truncate" title={nameB}>B · {nameB}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.label} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2 text-muted-foreground">{m.label}</td>
                  <td className={cn(
                    "px-4 py-2 text-right",
                    m.w === "A" ? "text-emerald-400 font-semibold" : "text-foreground",
                  )}>
                    {m.a}
                    <WinBadge side="A" w={m.w} />
                  </td>
                  <td className={cn(
                    "px-4 py-2 text-right",
                    m.w === "B" ? "text-emerald-400 font-semibold" : "text-foreground",
                  )}>
                    {m.b}
                    <WinBadge side="B" w={m.w} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pick overlap */}
      <Card className="bg-slate-900/60 border-slate-800">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider">
            Pick Overlap
            <span className="ml-2 normal-case text-[10px] font-normal">
              {sharedIds.length} shared · {onlyAIds.length} A-only · {onlyBIds.length} B-only
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {sharedIds.length === 0 && onlyAIds.length === 0 && onlyBIds.length === 0 && (
            <p className="text-xs text-muted-foreground font-mono">No picks to compare.</p>
          )}
          {sharedIds.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-emerald-500/70 font-mono mb-1.5">Shared</div>
              <div className="flex flex-wrap gap-1.5">
                {sharedIds.map(id => {
                  const info = pickInfoA.get(id)!;
                  return (
                    <span key={id} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/50 border border-emerald-700/40 text-emerald-300">
                      {info.playerName} · {info.statType} {info.ppLine}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {onlyAIds.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-primary/70 font-mono mb-1.5">A only</div>
              <div className="flex flex-wrap gap-1.5">
                {onlyAIds.map(id => {
                  const info = pickInfoA.get(id)!;
                  return (
                    <span key={id} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/5 border border-primary/20 text-primary/80">
                      {info.playerName} · {info.statType} {info.ppLine}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {onlyBIds.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-amber-500/70 font-mono mb-1.5">B only</div>
              <div className="flex flex-wrap gap-1.5">
                {onlyBIds.map(id => {
                  const info = pickInfoB.get(id)!;
                  return (
                    <span key={id} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950/30 border border-amber-700/30 text-amber-400/80">
                      {info.playerName} · {info.statType} {info.ppLine}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── HistoryPanel ─────────────────────────────────────────────────────────────
function HistoryPanel({
  entries,
  activeId,
  compareId,
  onSelect,
  onDelete,
  onRename,
  onCompare,
}: {
  entries: SavedLineup[];
  activeId: string | null;
  compareId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onCompare: (id: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(entry: SavedLineup, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(entry.id);
    setEditValue(entry.label ?? "");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit(id: string) {
    onRename(id, editValue);
    setEditingId(null);
  }

  if (entries.length === 0) return null;

  const canCompare = entries.length >= 2;

  return (
    <Card className="bg-slate-900/60 border-slate-800">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs uppercase font-mono text-muted-foreground tracking-wider flex items-center gap-1.5">
          <History className="w-3 h-3" />
          Saved Runs ({entries.length}/10)
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2 space-y-0.5">
        {entries.map(entry => {
          const isActive = entry.id === activeId;
          const isCompare = entry.id === compareId;
          const displayName = entry.label || entry.autoName;
          const ev = entry.result.portfolioStats.portfolioEV;
          const numLineups = entry.result.lineups.length;
          const pCash = Math.round(entry.result.portfolioStats.probAtLeastOneCashes * 100);
          const stake = entry.result.portfolioStats.totalStake;
          const fmtLabel = FORMAT_LABELS[entry.cfg.format] ?? entry.cfg.format;

          return (
            <div
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className={cn(
                "group flex items-center gap-1.5 rounded px-2 py-1.5 cursor-pointer transition-colors",
                isCompare
                  ? "bg-amber-950/30 border border-amber-700/40"
                  : isActive
                    ? "bg-primary/15 border border-primary/30"
                    : "hover:bg-slate-800/60 border border-transparent",
              )}
            >
              <div className="flex-1 min-w-0">
                {editingId === entry.id ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(entry.id)}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitEdit(entry.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    placeholder={entry.autoName}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:border-primary text-foreground"
                  />
                ) : (
                  <div className={cn(
                    "text-[10px] font-mono font-medium truncate",
                    isCompare ? "text-amber-300" : "text-foreground",
                  )} title={displayName}>
                    {displayName}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                    <Clock className="w-2 h-2" />
                    {relativeTime(entry.savedAt)}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {numLineups} lineup{numLineups !== 1 ? "s" : ""}
                  </span>
                  <span className={cn("text-[9px] font-mono", ev >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {sign(ev)}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className="px-1 py-px rounded text-[8px] font-mono bg-slate-800 border border-slate-700 text-slate-400">
                    {fmtLabel}
                  </span>
                  <span className="px-1 py-px rounded text-[8px] font-mono bg-slate-800 border border-slate-700 text-slate-400">
                    {entry.cfg.picksPerEntry}-pick
                  </span>
                  <span className="px-1 py-px rounded text-[8px] font-mono bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
                    {pCash}% cash
                  </span>
                  <span className="px-1 py-px rounded text-[8px] font-mono bg-slate-800 border border-slate-700 text-slate-400">
                    {dollars(stake)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {canCompare && !isActive && (
                  <button
                    onClick={e => { e.stopPropagation(); onCompare(isCompare ? null : entry.id); }}
                    title={isCompare ? "Exit comparison" : "Compare with active run"}
                    className={cn(
                      "p-1 rounded transition-colors",
                      isCompare
                        ? "bg-amber-900/50 text-amber-400 hover:bg-amber-900/80"
                        : "hover:bg-slate-700 text-muted-foreground hover:text-amber-400",
                    )}
                  >
                    <ArrowLeftRight className="w-2.5 h-2.5" />
                  </button>
                )}
                <button
                  onClick={e => startEdit(entry, e)}
                  title="Rename"
                  className="p-1 rounded hover:bg-slate-700 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
                  title="Delete"
                  className="p-1 rounded hover:bg-red-950/60 text-muted-foreground hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
              {isActive && editingId !== entry.id && (
                <Check className="w-3 h-3 text-primary shrink-0 ml-0.5" />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LineupFactory() {
  const [cfg, setCfg] = useState<LineupFactoryConfig>(() => loadCfg());
  const [cachedResult, setCachedResult] = useState<LineupFactoryResult | null>(() => loadResult());
  const [pinnedPicks, setPinnedPicks] = useState<PinnedPick[]>(() => readPinnedPicks());
  const [requiredPinnedIds, setRequiredPinnedIds] = useState<Set<number>>(() => loadRequiredIds());
  const [savedLineups, setSavedLineups] = useState<SavedLineup[]>(() => readSavedLineups());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const entries = readSavedLineups();
    return entries.length > 0 ? entries[0].id : null;
  });
  const [compareId, setCompareId] = useState<string | null>(null);
  const generate = useGenerateLineupFactory();
  const { addPick, setOptimizationObjective } = useEntry();

  // Persist cfg on every change
  useEffect(() => { saveCfg(cfg); }, [cfg]);

  // After each successful generation: append to history, activate it
  useEffect(() => {
    if (generate.data) {
      const entry = appendSavedLineup(cfg, generate.data);
      const next = readSavedLineups();
      setSavedLineups(next);
      setActiveId(entry.id);
      saveResult(generate.data);
      setCachedResult(generate.data);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate.data]);

  // Keep history in sync if another tab modifies it
  useEffect(() => {
    function sync() {
      setSavedLineups(readSavedLineups());
    }
    window.addEventListener("saved-lineups-changed", sync);
    return () => window.removeEventListener("saved-lineups-changed", sync);
  }, []);

  // Keep pinned picks synced
  useEffect(() => {
    function syncPinned() { setPinnedPicks(readPinnedPicks()); }
    window.addEventListener("pinned-picks-changed", syncPinned);
    return () => window.removeEventListener("pinned-picks-changed", syncPinned);
  }, []);

  // Resolve the result to display
  const activeEntry = activeId ? savedLineups.find(e => e.id === activeId) : null;
  const compareEntry = compareId ? savedLineups.find(e => e.id === compareId) : null;
  const result = activeEntry?.result ?? (generate.isPending ? null : (generate.data ?? cachedResult));

  // For each locked pick, count how many generated lineups actually contain it
  const lockedCoverage = useMemo(() => {
    if (!result?.lineups?.length) return undefined;
    const map = new Map<number, number>();
    for (const lu of result.lineups) {
      for (const pick of lu.picks) {
        if (requiredPinnedIds.has(pick.ppLineId)) {
          map.set(pick.ppLineId, (map.get(pick.ppLineId) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [result?.lineups, requiredPinnedIds]);

  const pinnedIds = new Set(pinnedPicks.map(p => p.ppLineId));

  // Derive isGppMode from the entry whose result is displayed (not current editor state)
  // so historical runs are labelled correctly when a saved entry is selected.
  const displayedObjective = activeEntry?.cfg.optimizationObjective ?? cfg.optimizationObjective;
  const isGppMode = displayedObjective === "gpp_mode";

  // Build ppLineId → FactoryScoredProp map for LineupCard leverage lookup
  const scoredPropsMap = useMemo(
    () => new Map((result?.scoredProps ?? []).map(p => [p.ppLineId, p])),
    [result?.scoredProps],
  );

  function handleGenerate() {
    const requiredLineIds = [...requiredPinnedIds].filter(id => pinnedPicks.some(p => p.ppLineId === id));
    generate.mutate({ data: { ...cfg, requiredLineIds: requiredLineIds.length > 0 ? requiredLineIds : undefined } });
  }

  function handleRemovePinned(ppLineId: number) {
    removePinnedPick(ppLineId);
    setPinnedPicks(readPinnedPicks());
    if (requiredPinnedIds.has(ppLineId)) {
      const next = new Set(requiredPinnedIds);
      next.delete(ppLineId);
      setRequiredPinnedIds(next);
      saveRequiredIds(next);
    }
  }

  function handleClearPinned() {
    clearPinnedPicks();
    setPinnedPicks([]);
    setRequiredPinnedIds(new Set());
    saveRequiredIds(new Set());
  }

  function handleToggleRequired(ppLineId: number) {
    const next = new Set(requiredPinnedIds);
    if (next.has(ppLineId)) {
      next.delete(ppLineId);
    } else {
      next.add(ppLineId);
    }
    setRequiredPinnedIds(next);
    saveRequiredIds(next);

    // Auto-set sport filter when all locked picks share the same sport
    if (next.size > 0) {
      const lockedSports = new Set(
        pinnedPicks.filter(p => next.has(p.ppLineId)).map(p => p.sport)
      );
      if (lockedSports.size === 1) {
        const sport = [...lockedSports][0];
        setCfg(c => ({ ...c, sport }));
      } else if (lockedSports.size > 1) {
        setCfg(c => ({ ...c, sport: undefined }));
      }
    }
  }

  function handleLoadLineup(lineup: GeneratedLineup) {
    setOptimizationObjective(cfg.optimizationObjective as import("@/lib/entry-context").OptimizationObjective);
    for (const pick of lineup.picks) {
      addPick({
        ppLineId:       pick.ppLineId,
        playerId:       pick.playerId,
        playerName:     pick.playerName,
        imageUrl:       pick.imageUrl ?? null,
        teamAbbr:       null,
        gameId:         pick.gameId ?? null,
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

  function handleDeleteSaved(id: string) {
    deleteSavedLineup(id);
    const next = readSavedLineups();
    setSavedLineups(next);
    if (activeId === id) {
      setActiveId(next.length > 0 ? next[0].id : null);
    }
  }

  function handleRenameSaved(id: string, label: string) {
    updateSavedLineupLabel(id, label);
    setSavedLineups(readSavedLineups());
  }

  const profileInfo = PROFILE_LABELS[cfg.varianceProfile];

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Factory className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold font-mono">Lineup Factory</h1>
          <p className="text-xs text-muted-foreground">Portfolio construction — risk-adjusted, diversified, correlation-aware</p>
        </div>
        {result && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground font-mono">
            {activeEntry && (
              <span className="text-primary font-medium truncate max-w-[160px]" title={activeEntry.label || activeEntry.autoName}>
                {activeEntry.label || activeEntry.autoName}
              </span>
            )}
            {activeEntry && <ChevronRight className="h-3 w-3" />}
            <span>{result.filteredPropCount} eligible</span>
            <ChevronRight className="h-3 w-3" />
            <span>{result.lineups.length} lineups</span>
            <ChevronRight className="h-3 w-3" />
            <span className={cn(profileInfo.color)}>{profileInfo.label}</span>
          </div>
        )}
      </div>

      {/* ── Two-column layout ── */}
      <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0 lg:overflow-hidden">
        {/* Config panel — fixed width on desktop, full width on mobile */}
        <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 lg:overflow-y-auto p-4 space-y-4">
          <PinnedPanel
            picks={pinnedPicks}
            requiredIds={requiredPinnedIds}
            picksPerEntry={cfg.picksPerEntry}
            onRemove={handleRemovePinned}
            onClear={handleClearPinned}
            onToggleRequired={handleToggleRequired}
            lockedCoverage={lockedCoverage}
            totalLineups={result?.lineups?.length}
          />
          <HistoryPanel
            entries={savedLineups}
            activeId={activeId}
            compareId={compareId}
            onSelect={id => { setActiveId(id); setCompareId(null); }}
            onDelete={id => { if (compareId === id) setCompareId(null); handleDeleteSaved(id); }}
            onRename={handleRenameSaved}
            onCompare={id => setCompareId(id)}
          />
          <ConfigPanel cfg={cfg} onChange={setCfg} onGenerate={handleGenerate} loading={generate.isPending} />
        </div>

        {/* Results panel — scrollable */}
        <div className="lg:flex-1 lg:min-w-0 lg:overflow-y-auto p-4">
          {generate.isPending && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3">
              <RefreshCw className="h-8 w-8 text-primary animate-spin" />
              <div className="text-sm text-muted-foreground font-mono">Scoring props and generating portfolio…</div>
            </div>
          )}

          {generate.isError && !generate.isPending && !result && (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2">
              <AlertTriangle className="h-8 w-8 text-red-400" />
              <div className="text-sm text-red-400 font-mono">Generation failed. Check filters — pool may be too small.</div>
              <Button variant="outline" size="sm" onClick={handleGenerate} className="mt-2 font-mono">
                Retry
              </Button>
            </div>
          )}

          {!result && !generate.isPending && !generate.isError && <EmptyState />}

          {result && !generate.isPending && activeEntry && compareEntry && (
            <CompareView
              runA={activeEntry}
              runB={compareEntry}
              onClose={() => setCompareId(null)}
            />
          )}

          {result && !generate.isPending && !(activeEntry && compareEntry) && (
            <div className="space-y-5">
              {/* Stale result banner when viewing a history entry that isn't the newest */}
              {activeEntry && savedLineups.length > 0 && activeEntry.id !== savedLineups[0].id && (
                <div className="flex items-center gap-2 rounded border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-xs text-muted-foreground font-mono">
                  <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>Viewing historical run from {new Date(activeEntry.savedAt).toLocaleString()}. Click the latest entry in the history panel to return to the most recent result.</span>
                </div>
              )}

              {/* Required lines warning */}
              {result.requiredLinesWarning && (
                <div className="flex items-start gap-2 rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-400 font-mono">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{result.requiredLinesWarning}</span>
                </div>
              )}
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
                        <LineupCard key={lu.id} lineup={lu} index={i} onLoad={handleLoadLineup} isGppMode={isGppMode} propsMap={scoredPropsMap} />
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Scored props */}
                <TabsContent value="props" className="mt-4">
                  <ScoredPropsTable props={result.scoredProps} pinnedIds={pinnedIds} biasWeight={cfg.biasWeight ?? 0} isGppMode={isGppMode} />
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
                        <Separator className="border-slate-800 my-1" />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Eligible props</span>
                          <span className="font-mono text-foreground">{result.filteredPropCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Lineups built</span>
                          <span className="font-mono text-foreground">{result.lineups.length}</span>
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
