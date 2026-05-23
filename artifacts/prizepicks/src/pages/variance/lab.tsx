import { useState } from "react";
import { FlaskConical, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/use-user-settings";

const SIGNAL_CARDS = [
  {
    key: "isBirthdayGame",
    emoji: "🎂",
    title: "Birthday Game Tracker",
    desc: "Track how players perform on their birthday. Anecdotally elevated — statistically unverified.",
  },
  {
    key: "isNewShoes",
    emoji: "👟",
    title: "New Shoes Signal",
    desc: "Some fans track equipment changes. Manual flag only. Zero quantitative backing.",
  },
  {
    key: "isHaircutGame",
    emoji: "💈",
    title: "Haircut Game Log",
    desc: "The original unverified signal. Log it for fun. Never trust it for decisions.",
  },
  {
    key: "socialSpikeScore",
    emoji: "📱",
    title: "Social Media Spike",
    desc: "Elevated social mentions may reflect public narrative — not edge. Entertainment value only.",
  },
];

export default function ExperimentalLab() {
  const { data: settings } = useUserSettings();
  const update = useUpdateUserSettings();
  const [logged, setLogged] = useState<Record<string, boolean>>({});

  if (!settings?.experimentalLabEnabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <FlaskConical className="w-16 h-16 text-amber-400/30" />
        <p className="text-muted-foreground font-mono">Experimental Lab is disabled.</p>
        <p className="text-xs text-muted-foreground font-mono">Enable it in Settings → Variance Intelligence to access this section.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Prominent disclaimer */}
      <div className="p-4 bg-amber-950/40 border border-amber-700/50 rounded-lg">
        <div className="flex items-start gap-3">
          <FlaskConical className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-300 text-sm">Experimental Signals — No Statistical Validity</div>
            <div className="text-xs text-amber-200/70 mt-1 space-y-1">
              <p>Everything in this lab is exploratory and unverified. These signals are provided for pattern-tracking and curiosity only.</p>
              <p>They do <strong className="text-amber-300">not</strong> influence EV calculations, optimizer recommendations, or probability scores.</p>
              <p>Use them to track patterns you observe — not to make betting decisions.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-border pb-4">
        <FlaskConical className="w-6 h-6 text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Experimental Signals Lab
            <span className="text-[10px] font-mono bg-amber-900/50 text-amber-400 border border-amber-700/50 px-1.5 py-0.5 rounded uppercase tracking-widest">EXPERIMENTAL</span>
          </h1>
          <p className="text-sm text-amber-200/60 font-mono">Unverified patterns for exploration only</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SIGNAL_CARDS.map(card => (
          <Card key={card.key} className="bg-slate-900 border-amber-900/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span>{card.emoji}</span>
                <span>{card.title}</span>
                <span className="ml-auto text-[9px] font-mono bg-amber-900/40 text-amber-500 border border-amber-800/50 px-1.5 py-0.5 rounded uppercase">UNVERIFIED</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{card.desc}</p>
              <Button
                size="sm"
                variant="outline"
                className={`text-xs font-mono border-amber-800/50 ${logged[card.key] ? "bg-amber-900/30 text-amber-300" : "bg-transparent text-muted-foreground hover:text-foreground"}`}
                onClick={() => setLogged(prev => ({ ...prev, [card.key]: !prev[card.key] }))}
              >
                <Plus className="w-3 h-3 mr-1" />
                {logged[card.key] ? "Logged (session only)" : "Log Signal"}
              </Button>
              <p className="text-[10px] text-slate-600 font-mono">Session-only · Not persisted · Zero EV impact</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-900/50 border-amber-900/20">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-xs font-mono text-amber-700/70">
            <FlaskConical className="w-3 h-3" />
            <span>Disable Experimental Lab in Settings if you want to remove this section from your interface.</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-xs h-6 text-amber-700 hover:text-amber-500"
              onClick={() => update.mutate({ experimentalLabEnabled: false })}
            >
              Disable Lab
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
