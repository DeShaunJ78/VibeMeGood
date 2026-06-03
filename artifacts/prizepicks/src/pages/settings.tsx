import { useState } from "react";
import { useGetDataHealth, getGetDataHealthQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { RefreshCw, Database, Server, CheckCircle2, AlertCircle, Clock, Brain, FlaskConical, Lock, Zap, DollarSign } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useUserSettings, useUpdateUserSettings, type UserSettings } from "@/hooks/use-user-settings";
import { apiUrl } from "@/lib/api-base";
import { EmptyState } from "@/components/empty-state";

const SIGNAL_TOGGLES = [
  { key: "fatigue",     label: "Fatigue & Rest Modeling", desc: "Back-to-backs, distance, timezone shift" },
  { key: "environment", label: "Game Environment",        desc: "Blowout probability, spread, game total" },
  { key: "usage",       label: "Role & Usage Trends",     desc: "Minutes trend, usage spike / drop" },
  { key: "matchup",     label: "Matchup Depth",           desc: "Historical vs opponent, over rate" },
  { key: "narrative",   label: "Narrative Context",       desc: "Low weight — revenge, national TV, playoffs" },
  { key: "referee",     label: "Referee Modeling",        desc: "Foul rate, pace factor (requires opt-in)" },
];

const MODE_TOGGLES = [
  { key: "aggressiveWeighting", label: "Aggressive Variance Weighting", desc: "Doubles validated signal weights. High-risk." },
  { key: "stablePicksOnly",     label: "Stable Picks Mode",            desc: "Only show props with stable volatility rating." },
  { key: "ceilingHunterMode",   label: "Ceiling Hunter Mode",          desc: "Prioritize usage spikes and elevated environments." },
  { key: "excludeHighVolatility", label: "Exclude High Volatility",    desc: "Remove boom/bust and volatile props from optimizer." },
];

const TIER_CONFIG = [
  { label: "A — Elite",       minEdge: 43, units: 5, color: "text-violet-400", bg: "bg-violet-950/30 border-violet-700/40", desc: "Top 5% of model confidence. Highest historical hit rate (~94%). Max stake." },
  { label: "B — Core",        minEdge: 30, units: 2, color: "text-emerald-400", bg: "bg-emerald-950/30 border-emerald-800/40", desc: "Top 20% — the primary recommendation tier. 83%+ historical hit rate." },
  { label: "C — Exploratory", minEdge: 20, units: 1, color: "text-amber-400",  bg: "bg-amber-950/20 border-amber-800/30", desc: "Edge 20–30%. Visible but lower priority. Use to fill lineup gaps." },
  { label: "D — Low",         minEdge: 0,  units: 0, color: "text-slate-500",  bg: "bg-slate-900 border-slate-800",        desc: "Edge below 20%. Hidden by default. Only visible in advanced view." },
];

function BankrollSection({ settings, onUpdate }: { settings: UserSettings; onUpdate: (patch: Partial<UserSettings>) => void }) {
  const [editing, setEditing] = useState<Record<string, string>>({});

  function startEdit(field: string, current: string | null) {
    setEditing(e => ({ ...e, [field]: current ?? "" }));
  }
  function commitEdit(field: string, key: keyof UserSettings) {
    const val = editing[field];
    if (val === undefined) return;
    const num = parseFloat(val);
    if (val !== "" && isNaN(num)) return;
    onUpdate({ [key]: val === "" ? null : String(num) } as Partial<UserSettings>);
    setEditing(e => { const n = { ...e }; delete n[field]; return n; });
  }

  const unitSize  = parseFloat(settings.unitSize  ?? "5");
  const bankroll  = parseFloat(settings.bankroll  ?? "500");
  const kelly     = parseFloat(settings.kellyFraction ?? "0.25");
  const dailyLoss = settings.dailyLossLimit ? parseFloat(settings.dailyLossLimit) : null;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="w-4 h-4 text-primary" /> Bankroll &amp; Staking
        </CardTitle>
        <CardDescription>
          Your capital allocation settings. These drive Kelly stake recommendations in the Entry Builder and the tier unit multipliers on the Slate Board.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Core numbers */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { field: "bankroll",       key: "bankroll"       as keyof UserSettings, label: "Bankroll ($)",     placeholder: "500",  hint: "Total capital set aside for PrizePicks" },
            { field: "unitSize",       key: "unitSize"       as keyof UserSettings, label: "Unit Size ($)",    placeholder: "5",    hint: "Base stake — 1 unit. Tiers multiply this." },
            { field: "kellyFraction",  key: "kellyFraction"  as keyof UserSettings, label: "Kelly Fraction",  placeholder: "0.25", hint: "Fraction of full Kelly to bet (0.25 = Quarter Kelly)" },
            { field: "dailyLossLimit", key: "dailyLossLimit" as keyof UserSettings, label: "Daily Loss Limit ($)", placeholder: "—", hint: "Stop-loss. Leave blank to disable." },
          ].map(({ field, key, label, placeholder, hint }) => {
            const stored = settings[key] as string | null;
            const isEditing = field in editing;
            return (
              <div key={field} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
                {isEditing ? (
                  <Input
                    autoFocus
                    type="number"
                    value={editing[field]}
                    onChange={e => setEditing(prev => ({ ...prev, [field]: e.target.value }))}
                    onBlur={() => commitEdit(field, key)}
                    onKeyDown={e => { if (e.key === "Enter") commitEdit(field, key); if (e.key === "Escape") setEditing(prev => { const n = { ...prev }; delete n[field]; return n; }); }}
                    className="h-7 text-sm font-mono bg-slate-900 border-slate-700 focus-visible:ring-primary/50 px-2"
                    placeholder={placeholder}
                  />
                ) : (
                  <button
                    onClick={() => startEdit(field, stored)}
                    className="text-lg font-bold font-mono text-foreground hover:text-primary transition-colors w-full text-left"
                  >
                    {stored ? (field === "kellyFraction" ? `${(parseFloat(stored) * 100).toFixed(0)}%` : `$${parseFloat(stored).toLocaleString()}`) : <span className="text-slate-600 text-sm">{placeholder === "—" ? "Not set" : placeholder}</span>}
                  </button>
                )}
                <div className="text-[10px] text-slate-600 mt-1 leading-tight">{hint}</div>
              </div>
            );
          })}
        </div>

        {/* Derived summary */}
        <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-[11px] font-mono">
          <div><span className="text-muted-foreground">1 unit = </span><span className="text-foreground font-semibold">${unitSize.toFixed(2)}</span></div>
          <div><span className="text-muted-foreground">5 units (Tier A) = </span><span className="text-violet-400 font-semibold">${(unitSize * 5).toFixed(2)}</span></div>
          <div><span className="text-muted-foreground">2 units (Tier B) = </span><span className="text-emerald-400 font-semibold">${(unitSize * 2).toFixed(2)}</span></div>
          {dailyLoss != null
            ? <div><span className="text-muted-foreground">Daily limit = </span><span className="text-amber-400 font-semibold">${dailyLoss.toFixed(2)}</span></div>
            : <div><span className="text-muted-foreground">Kelly base = </span><span className="text-foreground font-semibold">${bankroll.toFixed(0)} × {(kelly * 100).toFixed(0)}%K</span></div>
          }
        </div>

        {/* Tier table */}
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Stake Tiers — based on Audit Edge Deciles</div>
          <div className="space-y-1.5">
            {TIER_CONFIG.map(t => (
              <div key={t.label} className={`flex items-center gap-3 border rounded-lg px-3 py-2 ${t.bg}`}>
                <div className={`font-mono font-bold text-xs w-28 shrink-0 ${t.color}`}>{t.label}</div>
                <div className="text-[11px] text-slate-400 flex-1">{t.desc}</div>
                <div className={`font-mono font-bold text-sm shrink-0 ${t.color}`}>
                  {t.units > 0 ? `${t.units}u = $${(unitSize * t.units).toFixed(2)}` : "Hidden"}
                </div>
              </div>
            ))}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}

function VarianceIntelSection({ settings, onUpdate }: { settings: UserSettings; onUpdate: (patch: Partial<UserSettings>) => void }) {
  const [showExpLab, setShowExpLab] = useState(false);
  const signals = (settings.varianceSignals ?? {}) as Record<string, boolean>;
  const modes = (settings.varianceModes ?? {}) as Record<string, boolean>;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="w-4 h-4 text-primary" /> Variance Intelligence
        </CardTitle>
        <CardDescription>
          Contextual signals layered on top of every prop. When OFF, the app behaves exactly as before — no variance signals appear anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Master toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-700 rounded-lg">
          <div>
            <div className="font-semibold text-sm">Enable Variance Intelligence</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Adds fatigue, blowout risk, usage trends, and matchup depth to every prop.
            </div>
          </div>
          <Switch
            checked={settings.varianceIntelEnabled ?? false}
            onCheckedChange={v => onUpdate({ varianceIntelEnabled: v })}
          />
        </div>

        {settings.varianceIntelEnabled && (
          <div className="space-y-5 pl-4 border-l-2 border-primary/20">
            {/* Signal sub-toggles */}
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Active Signals</div>
              <div className="space-y-3">
                {SIGNAL_TOGGLES.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                    <Switch
                      checked={signals[key] ?? false}
                      onCheckedChange={v => onUpdate({ varianceSignals: { ...signals, [key]: v } as UserSettings["varianceSignals"] })}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Optimizer modes */}
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Optimizer Modes</div>
              <div className="space-y-3">
                {MODE_TOGGLES.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                    <Switch
                      checked={modes[key] ?? false}
                      onCheckedChange={v => onUpdate({ varianceModes: { ...modes, [key]: v } as UserSettings["varianceModes"] })}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Experimental Lab */}
            <div className="p-4 bg-amber-950/30 border border-amber-700/40 rounded-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" />
                    Experimental Signals Lab
                    <span className="text-[10px] font-mono bg-amber-900/50 text-amber-400 border border-amber-700/50 px-1.5 py-0.5 rounded uppercase tracking-widest">LAB</span>
                  </div>
                  <div className="text-xs text-amber-200/60 mt-1">
                    Birthday games, new shoes, haircut trends. Entertainment only. <strong className="text-amber-300">Never</strong> touches EV calculations.
                  </div>
                </div>
                <Switch
                  checked={settings.experimentalLabEnabled ?? false}
                  onCheckedChange={v => {
                    if (v && !settings.experimentalLabAcknowledged) {
                      setShowExpLab(true);
                    } else {
                      onUpdate({ experimentalLabEnabled: v });
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={showExpLab} onOpenChange={setShowExpLab}>
        <AlertDialogContent className="bg-slate-900 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-amber-300 flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> Experimental Signals Lab
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 space-y-2">
              <p>The Experimental Lab contains signals with <strong className="text-foreground">no statistical validation</strong>.</p>
              <p>These include: birthday games, new shoes, haircut patterns, social media activity.</p>
              <p><strong className="text-amber-300">These signals will NEVER influence EV calculations, optimizer recommendations, or probability scores.</strong></p>
              <p>Enable this if you want to track and explore unverified patterns for your own curiosity.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Off</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onUpdate({ experimentalLabEnabled: true, experimentalLabAcknowledged: true })}
              className="bg-amber-800 hover:bg-amber-700 text-amber-100"
            >
              I Understand — Enable Lab
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const SYNC_JOBS = [
  // PrizePicks lines are NOT server-syncable (PerimeterX 403s every server fetch).
  // Use the browser copy-paste import card below instead.
  { label: "Injury Reports",     endpoint: "/api/sync/injuries" },
  { label: "External Odds",      endpoint: "/api/sync/external-odds" },
  { label: "Player Projections", endpoint: "/api/sync/projections" },
  { label: "Game Scores",        endpoint: "/api/sync/scores" },
  { label: "Variance Compute",   endpoint: "/api/sync/variance" },
  { label: "Team Pace Ratings",  endpoint: "/api/admin/sync/pace" },
  { label: "Sync Games",         endpoint: "/api/sync/game-schedule" },
  { label: "Run Calibration",   endpoint: "/api/sync/calibration" },
  { label: "Backfill History",  endpoint: "/api/sync/historical-stats" },
];

// Maps a manual sync job to the data_pull_logs provider it refreshes, so each
// row can show live status instead of a static button.
const JOB_PROVIDER: Record<string, string> = {
  "/api/sync/injuries":      "injury-news",
  "/api/sync/external-odds": "the-odds-api",
  "/api/sync/projections":   "nba-stats",
  "/api/sync/scores":        "espn",
  "/api/sync/variance":      "internal",
  "/api/sync/game-schedule": "espn",
};

function StatusDot({ status }: { status: string }) {
  if (status === "success") return <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />;
  if (status === "error")   return <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />;
  if (status === "running") return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-slate-600 inline-block" />;
}

export default function Settings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingPreLock, setSyncingPreLock] = useState(false);
  const [syncingJob, setSyncingJob] = useState<string | null>(null);
  const [ppPaste, setPpPaste] = useState("");
  const [ppImporting, setPpImporting] = useState<"idle" | "importing" | "done" | "error">("idle");
  const [ppDialogOpen, setPpDialogOpen] = useState(false);
  const [ppFetching, setPpFetching] = useState<"idle" | "fetching" | "done" | "cors-blocked" | "error">("idle");
  const { data: userSettings } = useUserSettings();
  const updateSettings = useUpdateUserSettings();

  const { data, isLoading, refetch } = useGetDataHealth({
    query: { queryKey: getGetDataHealthQueryKey() },
  });

  async function triggerSync(endpoint: string, label: string) {
    setSyncingJob(endpoint);
    try {
      const r = await fetch(apiUrl(endpoint), { method: "POST" });
      if (!r.ok) throw new Error();
      toast({ title: `Sync started`, description: `${label} sync initiated.` });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
        refetch();
      }, 1500);
    } catch {
      toast({ title: "Sync failed", description: `Could not start ${label} sync.`, variant: "destructive" });
    } finally {
      setSyncingJob(null);
    }
  }

  async function syncAll() {
    setSyncingAll(true);
    for (const job of SYNC_JOBS) {
      try {
        await fetch(apiUrl(job.endpoint), { method: "POST" });
        await new Promise(r => setTimeout(r, 200));
      } catch { /* continue */ }
    }
    toast({ title: "All syncs started", description: "All data providers refreshed." });
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
      refetch();
    }, 2000);
    setSyncingAll(false);
  }

  const serverOrigin = window.location.origin;
  const importUrl = `${serverOrigin}/api/sync/pp-lines-import`;
  const ppApiUrl = "https://api.prizepicks.com/projections?per_page=25000&single_stat=true&include=new_player,league";

  // One-click sync bookmarklet: runs inside the user's logged-in prizepicks.com tab,
  // fetches the projections feed (same-site, cookies + PerimeterX pass), then POSTs
  // straight to our import endpoint (CORS is open). No copy-paste required.
  const bookmarklet =
    "javascript:(async()=>{try{const r=await fetch(" + JSON.stringify(ppApiUrl) +
    ",{credentials:'include'});if(!r.ok)throw new Error('PrizePicks returned '+r.status+' \\u2014 make sure you are logged in at prizepicks.com');" +
    "const j=await r.json();if(!j||!j.data||!j.included)throw new Error('That was not the projections feed.');" +
    "const p=await fetch(" + JSON.stringify(importUrl) +
    ",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:j.data,included:j.included})});" +
    "const o=await p.json().catch(()=>({}));if(!p.ok)throw new Error(o.error||('Import failed: '+p.status));" +
    "alert('\\u2713 PrizePicks synced: '+o.recordsProcessed+' lines imported into your Workstation.');}" +
    "catch(e){alert('PrizePicks sync failed: '+(e&&e.message?e.message:e));}})();";

  // React sanitizes javascript: hrefs, so set it via the DOM after mount so the
  // anchor remains draggable to the bookmarks bar.
  const setBookmarkletRef = (el: HTMLAnchorElement | null) => {
    if (el) el.setAttribute("href", bookmarklet);
  };

  async function importPpPaste() {
    setPpImporting("importing");
    try {
      let parsed: { data?: unknown[]; included?: unknown[] };
      try {
        parsed = JSON.parse(ppPaste);
      } catch {
        throw new Error("That isn't valid JSON. Make sure you copied the entire page (Ctrl+A then Ctrl+C).");
      }
      if (!Array.isArray(parsed?.data) || !Array.isArray(parsed?.included)) {
        throw new Error("This doesn't look like the PrizePicks feed — it should contain 'data' and 'included' arrays. You may have copied a login or block page.");
      }
      const res = await fetch(importUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: parsed.data, included: parsed.included }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Server returned ${res.status}`);
      }
      const result = await res.json() as { recordsProcessed: number };
      setPpImporting("done");
      setPpPaste("");
      toast({ title: "PrizePicks synced", description: `${result.recordsProcessed} lines imported.` });
      setTimeout(() => {
        setPpImporting("idle");
        qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
        refetch();
      }, 2500);
    } catch (e) {
      setPpImporting("error");
      toast({
        title: "Import failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setTimeout(() => setPpImporting("idle"), 5000);
    }
  }


  async function fetchPPDirect() {
    setPpFetching("fetching");
    try {
      // Attempt a direct cross-origin fetch using the user's browser credentials.
      // Works if PP's CORS headers allow it; throws TypeError if blocked.
      const ppRes = await fetch(ppApiUrl, { credentials: "include" });
      if (!ppRes.ok) {
        throw new Error(`PrizePicks returned ${ppRes.status}. Make sure you're logged in at app.prizepicks.com first.`);
      }
      const json = await ppRes.json() as { data?: unknown[]; included?: unknown[] };
      if (!Array.isArray(json?.data) || !Array.isArray(json?.included)) {
        throw new Error("Response wasn't the projections feed. Try logging in to PrizePicks first.");
      }
      const importRes = await fetch(importUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: json.data, included: json.included }),
      });
      if (!importRes.ok) {
        const err = await importRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Import failed: ${importRes.status}`);
      }
      const result = await importRes.json() as { recordsProcessed: number };
      setPpFetching("done");
      toast({ title: "PrizePicks synced", description: `${result.recordsProcessed} lines imported.` });
      setTimeout(() => {
        setPpFetching("idle");
        setPpDialogOpen(false);
        qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
        refetch();
      }, 2000);
    } catch (e) {
      // TypeError = CORS block (browser won't say which, security spec).
      // Any other error = actual fetch/import failure.
      const isCors = e instanceof TypeError;
      setPpFetching(isCors ? "cors-blocked" : "error");
      if (!isCors) {
        toast({
          title: "Fetch failed",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      }
    }
  }

  async function preLockSync() {
    setSyncingPreLock(true);
    try {
      await fetch(apiUrl("/api/sync/pre-lock"), { method: "POST" });
      toast({ title: "Pre-lock sync started", description: "Lines, injuries, and odds refreshing now." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
        refetch();
      }, 2000);
    } catch {
      toast({ title: "Pre-lock sync failed", variant: "destructive" });
    } finally {
      setSyncingPreLock(false);
    }
  }

  const providerByName: Record<string, any> = {};
  for (const p of ((data?.providers ?? []) as any[])) providerByName[p.name] = p;

  // PrizePicks freshness is driven by actual pp_lines age (boardAgeHours), the
  // most reliable "is the board current" signal — turns green right after import.
  const ppProvider = providerByName["prizepicks"];
  const ppAge = data?.boardAgeHours ?? null;
  const ppNever = !data?.boardFreshnessAt || ppAge == null;
  const ppFresh = !ppNever && ppAge <= 6;
  const ppLineCount = ppProvider?.recordsLastSync ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings & Data Health</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {data && (
            <Badge
              variant="outline"
              className={data.mode === "live"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 font-mono"
                : "bg-amber-500/10 text-amber-400 border-amber-500/40 font-mono"
              }
            >
              {data.mode.toUpperCase()} MODE
            </Badge>
          )}
          <Button
            size="sm"
            onClick={preLockSync}
            disabled={syncingPreLock || syncingAll}
            className="font-mono text-xs h-8 bg-amber-600 hover:bg-amber-500 text-white border-0"
          >
            <Lock className={`w-3 h-3 mr-1.5 ${syncingPreLock ? "animate-pulse" : ""}`} />
            {syncingPreLock ? "Syncing…" : "Pre-Lock Sync"}
          </Button>
          <Button
            size="sm"
            onClick={syncAll}
            disabled={syncingAll || syncingPreLock}
            className="font-mono text-xs h-8 bg-primary hover:bg-primary/90"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${syncingAll ? "animate-spin" : ""}`} />
            {syncingAll ? "Syncing…" : "Sync All"}
          </Button>
        </div>
      </div>

      {userSettings && (
        <BankrollSection settings={userSettings} onUpdate={patch => updateSettings.mutate(patch)} />
      )}

      {userSettings && (
        <VarianceIntelSection
          settings={userSettings}
          onUpdate={patch => updateSettings.mutate(patch)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Manual sync controls */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="w-4 h-4 text-primary" /> Data Sync
                </CardTitle>
                <CardDescription className="mt-1">Manually trigger individual data provider syncs</CardDescription>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed max-w-lg">
                  The Slate Board only shows PrizePicks lines synced in the last 24 hours. After importing lines, run{" "}
                  <span className="font-mono text-foreground/80">Sync All</span> or individual provider jobs so{" "}
                  <span className="font-mono text-foreground/80">last_synced_at</span> stays current.
                </p>
              </div>
              <Button
                size="sm"
                onClick={syncAll}
                disabled={syncingAll}
                className="shrink-0 font-mono text-xs h-8 bg-primary hover:bg-primary/90"
              >
                <RefreshCw className={`w-3 h-3 mr-1.5 ${syncingAll ? "animate-spin" : ""}`} />
                {syncingAll ? "Syncing…" : "Sync All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* PrizePicks lines — browser sync; row reflects real board freshness */}
            <div className={`flex items-center justify-between p-3 bg-slate-950 border rounded ${
              ppFresh ? "border-emerald-500/30" : ppNever ? "border-slate-800" : "border-amber-500/30"
            }`}>
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${
                  ppFresh ? "bg-emerald-400" : ppNever ? "bg-slate-600" : "bg-amber-400"
                }`} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">PrizePicks Lines</span>
                    <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">Browser</span>
                  </div>
                  <span className={`text-[10px] font-mono ${ppFresh ? "text-emerald-400/80" : ppNever ? "text-slate-500" : "text-amber-400/80"}`}>
                    {ppNever
                      ? "Never imported"
                      : `${ppFresh ? "Fresh" : "Stale"}${ppLineCount != null ? ` · ${ppLineCount} lines` : ""} · ${
                          data?.boardFreshnessAt ? formatDistanceToNow(new Date(data.boardFreshnessAt), { addSuffix: true }) : ""
                        }`}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPpDialogOpen(true)}
                className={`h-7 font-mono text-xs ${
                  ppFresh
                    ? "border-emerald-600/50 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20"
                    : "border-amber-600/50 bg-amber-600/10 text-amber-300 hover:bg-amber-600/20"
                }`}
              >
                {ppFresh ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                {ppFresh ? "Re-sync" : "Sync"}
              </Button>
            </div>

            {SYNC_JOBS.map(job => {
              const prov = JOB_PROVIDER[job.endpoint] ? providerByName[JOB_PROVIDER[job.endpoint]] : undefined;
              const isRunning = syncingJob === job.endpoint;
              const ok = prov?.status === "success";
              const failed = prov?.status === "error";
              const dotClass = isRunning ? "bg-amber-400 animate-pulse"
                : ok ? "bg-emerald-400"
                : failed ? "bg-rose-400"
                : "bg-slate-600";
              const borderClass = failed ? "border-rose-500/30" : ok ? "border-slate-800" : "border-slate-800";
              return (
                <div
                  key={job.endpoint}
                  className={`flex items-center justify-between p-3 bg-slate-950 border rounded ${borderClass}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${dotClass}`} />
                    <div>
                      <span className="font-mono text-sm block">{job.label}</span>
                      {prov && (
                        <span className={`text-[10px] font-mono ${failed ? "text-rose-400/80" : ok ? "text-muted-foreground" : "text-slate-500"}`}>
                          {prov.lastSuccessAt
                            ? `${prov.recordsLastSync != null ? `${prov.recordsLastSync} · ` : ""}${formatDistanceToNow(new Date(prov.lastSuccessAt), { addSuffix: true })}`
                            : "Never run"}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => triggerSync(job.endpoint, job.label)}
                    disabled={isRunning || syncingAll}
                    className="h-7 font-mono text-xs border-slate-700 bg-slate-800 hover:bg-slate-700"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${isRunning ? "animate-spin" : ""}`} />
                    {isRunning ? "Running" : "Sync"}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Recent sync logs */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="w-4 h-4 text-primary" /> Recent Sync Logs
            </CardTitle>
            <CardDescription>Latest automated data pull results</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-800" />)}
              </div>
            ) : data?.lastPullLogs && data.lastPullLogs.length > 0 ? (
              <div className="space-y-2">
                {data.lastPullLogs.map((log: any) => (
                  <div key={log.id} className="flex flex-col p-3 bg-slate-950 border border-slate-800 rounded gap-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusDot status={log.status} />
                        <span className="font-bold text-sm font-mono">{log.jobName}</span>
                      </div>
                      <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                        log.status === "success" ? "bg-emerald-500/10 text-emerald-400" :
                        log.status === "error"   ? "bg-rose-500/10 text-rose-400" :
                        log.status === "running" ? "bg-amber-500/10 text-amber-400" :
                        "bg-slate-800 text-slate-400"
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                      <span>{log.recordsProcessed ?? 0} records</span>
                      <span>{formatDistanceToNow(new Date(log.startedAt), { addSuffix: true })}</span>
                    </div>
                    {log.errorMessage && (
                      <div className="text-[10px] text-rose-400 font-mono bg-rose-900/20 px-2 py-1 rounded">
                        {log.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No sync logs yet"
                description="Run Sync All or an individual provider sync. Logs appear here after each pull completes."
              />
            )}
          </CardContent>
        </Card>

        {/* Data providers */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4 text-primary" /> Data Providers
            </CardTitle>
            <CardDescription>
              Live sync status — last 10 runs per provider
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-800" />)}
              </div>
            ) : data?.providers && data.providers.length > 0 ? (
              <div className="space-y-2">
                {data.providers.map((p: any, i: number) => {
                  const isError   = p.status === "error";
                  const isNever   = p.status === "never_run";
                  const isRunning = p.status === "running";
                  const rateOk    = p.recentSuccessRate === null || p.recentSuccessRate >= 0.5;
                  const degraded  = isError || !rateOk;

                  return (
                    <div
                      key={i}
                      className={`p-3 bg-slate-950 border rounded ${
                        degraded ? "border-red-500/40" : isRunning ? "border-amber-500/40" : "border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {degraded
                            ? <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                            : isRunning
                              ? <RefreshCw className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
                              : isNever
                                ? <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
                                : <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          }
                          <div>
                            <span className="font-bold font-mono text-sm block">
                              {p.label ?? p.name}
                            </span>
                            {p.lastSuccessAt && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                Last OK: {formatDistanceToNow(new Date(p.lastSuccessAt), { addSuffix: true })}
                                {p.recordsLastSync != null && ` · ${p.recordsLastSync} records`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.recentSuccessRate !== null && (
                            <span className={`text-[10px] font-mono ${
                              p.recentSuccessRate >= 0.8 ? "text-emerald-400"
                              : p.recentSuccessRate >= 0.5 ? "text-amber-400"
                              : "text-red-400"
                            }`}>
                              {Math.round(p.recentSuccessRate * 100)}%
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className={
                              degraded  ? "text-red-400 border-red-400/30 font-mono text-[10px]"
                              : isRunning ? "text-amber-400 border-amber-400/30 font-mono text-[10px]"
                              : isNever  ? "text-slate-500 border-slate-600 font-mono text-[10px]"
                              : "text-emerald-400 border-emerald-400/30 font-mono text-[10px]"
                            }
                          >
                            {isNever ? "NEVER RUN" : p.status?.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                      {degraded && p.lastError && (
                        <p className="text-[10px] text-red-400/80 font-mono mt-1.5 truncate">
                          {p.lastError}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground font-mono">No providers listed.</div>
            )}
          </CardContent>
        </Card>

        {/* Mode info card */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" /> System Info
            </CardTitle>
            <CardDescription>Runtime environment and data mode</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">System Health</span>
              <Badge
                variant="outline"
                className={data?.systemHealthy
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 font-mono"
                  : "bg-red-500/10 text-red-400 border-red-500/40 font-mono"
                }
              >
                {data?.systemHealthy ? "HEALTHY" : "DEGRADED"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">Board Freshness</span>
              <span className={`font-mono text-sm font-bold ${
                data?.boardAgeHours == null ? "text-slate-500"
                : data.boardAgeHours < 1 ? "text-emerald-400"
                : data.boardAgeHours < 3 ? "text-amber-400"
                : "text-red-400"
              }`}>
                {data?.boardAgeHours != null
                  ? `${data.boardAgeHours}h ago`
                  : data?.boardFreshnessAt
                    ? formatDistanceToNow(new Date(data.boardFreshnessAt), { addSuffix: true })
                    : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">Data Mode</span>
              <Badge
                variant="outline"
                className={data?.mode === "live"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 font-mono"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/40 font-mono"
                }
              >
                {data?.mode?.toUpperCase() ?? "UNKNOWN"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded">
              <span className="font-mono text-sm text-muted-foreground">Sync Log Entries</span>
              <span className="font-mono text-sm font-bold text-primary">{data?.lastPullLogs?.length ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PrizePicks sync dialog */}
      <Dialog open={ppDialogOpen} onOpenChange={(open) => { setPpDialogOpen(open); if (!open) setPpFetching("idle"); }}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono flex items-center gap-2 text-amber-300">
              <Zap className="w-4 h-4" /> Sync PrizePicks Lines
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Make sure you&apos;re already logged in at <span className="text-slate-300 font-mono">app.prizepicks.com</span> in this browser, then tap below.
            </DialogDescription>
          </DialogHeader>

          {/* Primary: one-tap auto-fetch */}
          {ppFetching !== "cors-blocked" && (
            <div className="space-y-2">
              <Button
                onClick={fetchPPDirect}
                disabled={ppFetching === "fetching" || ppFetching === "done"}
                className="w-full h-12 font-mono text-sm bg-amber-600 hover:bg-amber-500 text-white border-0 disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${ppFetching === "fetching" ? "animate-spin" : ""}`} />
                {ppFetching === "fetching" ? "Fetching lines…" :
                 ppFetching === "done"     ? "✓ Lines imported!" :
                 ppFetching === "error"    ? "Retry fetch" :
                 "Fetch PrizePicks Lines"}
              </Button>
              {ppFetching === "idle" && (
                <p className="text-[10px] text-center text-muted-foreground">
                  Pulls directly from PrizePicks using your login session.
                </p>
              )}
              {ppFetching === "error" && (
                <p className="text-[10px] text-center text-rose-400 font-mono">
                  Fetch failed — see toast. Check you&apos;re logged in at app.prizepicks.com and try again.
                </p>
              )}
            </div>
          )}

          {/* CORS-blocked fallback — shown only after a CORS failure */}
          {ppFetching === "cors-blocked" && (
            <div className="space-y-3">
              <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-rose-300 font-mono">
                PrizePicks blocked the direct fetch (CORS restriction). Use one of the methods below instead.
              </div>

              {/* Bookmarklet — works on desktop + iOS Safari */}
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <p className="font-mono text-xs font-bold text-amber-300">Desktop / iOS Safari — one-click bookmarklet</p>
                <ol className="text-[11px] text-muted-foreground space-y-1.5 list-none">
                  <li className="flex gap-2">
                    <span className="text-amber-500 font-mono shrink-0 font-bold">Desktop:</span>
                    <span>Drag the button below to your bookmarks bar. Then go to <span className="text-slate-300 font-mono">app.prizepicks.com</span> and click it — done.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-amber-500 font-mono shrink-0 font-bold">iPhone:</span>
                    <span>Bookmark any page in Safari, then edit that bookmark and replace the URL with the bookmarklet code. Tap &quot;Copy code&quot; below first.</span>
                  </li>
                </ol>
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    ref={setBookmarkletRef}
                    href="#"
                    onClick={e => e.preventDefault()}
                    draggable
                    className="inline-flex items-center gap-1.5 cursor-grab rounded bg-amber-700 px-3 py-1.5 font-mono text-xs font-bold text-white no-underline hover:bg-amber-600"
                  >
                    <Zap className="w-3 h-3" /> PP → Workstation
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { navigator.clipboard.writeText(bookmarklet); toast({ title: "Bookmarklet code copied", description: "Paste it as the URL of a new Safari bookmark." }); }}
                    className="h-7 font-mono text-xs border-slate-600 text-slate-300"
                  >
                    Copy code
                  </Button>
                </div>
              </div>

              {/* Manual paste — last resort */}
              <details className="group">
                <summary className="cursor-pointer text-[10px] font-mono text-muted-foreground hover:text-slate-300 select-none list-none flex items-center gap-1">
                  <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
                  Manual paste fallback (Android Chrome / last resort)
                </summary>
                <div className="mt-2 space-y-2 rounded border border-slate-700 bg-slate-950 p-3">
                  <p className="text-[10px] text-muted-foreground">
                    Open the <a href={ppApiUrl} target="_blank" rel="noreferrer" className="text-amber-300 underline">PP data feed</a>, then in Chrome on Android tap ⋮ → <strong className="text-slate-300">Share → Copy text</strong> (not Copy link). Paste below.
                  </p>
                  <textarea
                    value={ppPaste}
                    onChange={e => setPpPaste(e.target.value)}
                    placeholder="Paste the PrizePicks JSON here…"
                    spellCheck={false}
                    className="w-full h-20 rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[10px] text-slate-300 resize-y focus:outline-none focus:border-amber-500/50"
                  />
                  <Button
                    onClick={importPpPaste}
                    disabled={ppImporting === "importing" || ppPaste.trim().length === 0}
                    className="w-full h-8 font-mono text-xs bg-amber-600 hover:bg-amber-500 text-white border-0 disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1.5 ${ppImporting === "importing" ? "animate-spin" : ""}`} />
                    {ppImporting === "importing" ? "Importing…" : ppImporting === "done" ? "✓ Done" : "Import Pasted Lines"}
                  </Button>
                </div>
              </details>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPpFetching("idle")}
                className="w-full h-7 font-mono text-xs text-muted-foreground"
              >
                ← Try auto-fetch again
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
