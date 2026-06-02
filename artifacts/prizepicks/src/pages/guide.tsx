import { useEffect, useRef, useState, useMemo } from "react";
import { BookOpen, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const SECTIONS = [
  // ── Start here: the absolute basics ──
  { id: "what-is-betting", title: "Sports Betting in Plain English" },
  { id: "what-is",         title: "What Is VibeMeGood?" },
  { id: "prizepicks",      title: "How PrizePicks Works" },
  { id: "projections",     title: "How Player Projections Work" },
  { id: "more-less",       title: "Picking 'More' vs. 'Less'" },
  { id: "power-vs-flex",   title: "Power Plays vs. Flex Plays" },
  { id: "golden-rules",    title: "The Golden Rules" },
  // ── How to read the metrics ──
  { id: "metrics-intro",   title: "How to Read the Metrics" },
  { id: "line-types",      title: "Line Types: Standard, Goblin & Demon" },
  { id: "true-edge",       title: "True Edge — Your #1 Number" },
  { id: "hit-prob",        title: "Hit Probability" },
  { id: "market-lines",    title: "Market Lines" },
  { id: "ev",              title: "Expected Value (EV)" },
  { id: "best-value",      title: "The ★ BEST VALUE Badge" },
  { id: "kelly",           title: "Kelly Criterion (Bet Sizing)" },
  // ── Doing it: the daily workflow ──
  { id: "workflow",        title: "Daily Workflow, Start to Finish" },
  { id: "lineup-factory",  title: "Lineup Factory — Auto-Build" },
  { id: "entry-builder",   title: "Entry Builder (Manual Build)" },
  { id: "submit",          title: "Submitting on PrizePicks" },
  // ── Tools, tracking & discipline ──
  { id: "ai-analyst",      title: "AI Analyst" },
  { id: "injuries",        title: "Injuries & News" },
  { id: "review",          title: "Performance Review" },
  { id: "clv-guide",       title: "CLV — The Pro Standard" },
  { id: "bankroll",        title: "Bankroll Management" },
  { id: "mistakes",        title: "Common Mistakes" },
  { id: "glossary",        title: "Beginner's Glossary" },
  { id: "cheatsheet",      title: "Quick Reference Cheat Sheet" },
  // ── Part 5 — Under the hood ──
  { id: "model-audit-intro",  title: "The Model Audit — What It Is" },
  { id: "model-health",       title: "Model Health Metrics Explained" },
  { id: "tier1-factor",       title: "Tier 1 — Factor Audit" },
  { id: "tier2-stat",         title: "Tier 2 — Stat Audit" },
  { id: "tier3-sport",        title: "Tier 3 — Sport Audit" },
  { id: "tier4-edge",         title: "Tier 4 — Edge Audit" },
  { id: "tier5-roi",          title: "Tier 5 — ROI & CLV Audit" },
  { id: "tier5a-decile",      title: "Tier 5A — Edge Decile Audit" },
  { id: "what-edge-means",    title: "What 'Edge' Means on the Slate Board" },
  { id: "threshold-guide",    title: "Choosing Your Edge Threshold" },
];

function Rule({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary font-mono text-xs font-bold flex items-center justify-center border border-primary/30 mt-0.5">{n}</span>
      <div>
        <div className="text-sm font-semibold text-foreground mb-0.5">{title}</div>
        <div className="text-xs text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-10 pb-5 border-l border-slate-800 last:border-l-transparent last:pb-0">
      <span className="absolute -left-[13px] top-0 w-6 h-6 rounded-full bg-primary text-primary-foreground font-mono text-xs font-bold flex items-center justify-center ring-4 ring-background">{n}</span>
      <div className="text-sm font-semibold text-foreground mb-1">{title}</div>
      <div className="text-xs text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-base font-bold font-mono text-foreground border-b border-slate-800 pb-2 mb-4">{title}</h2>
      <div className="text-xs text-muted-foreground leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

function Callout({ color = "primary", children }: { color?: "primary" | "emerald" | "red" | "amber"; children: React.ReactNode }) {
  const colors = {
    primary: "bg-primary/10 border-primary/30 text-primary",
    emerald: "bg-emerald-950/40 border-emerald-800/40 text-emerald-300",
    red:     "bg-red-950/40 border-red-800/40 text-red-300",
    amber:   "bg-amber-950/40 border-amber-800/40 text-amber-300",
  };
  return (
    <div className={`border rounded-lg px-3 py-2 text-xs font-mono leading-relaxed ${colors[color]}`}>
      {children}
    </div>
  );
}

function QR({ situation, action }: { situation: string; action: string }) {
  const color = action.startsWith("Skip") || action.startsWith("Never") ? "text-red-400"
    : action.startsWith("Play") || action.startsWith("Strong") ? "text-emerald-400"
    : "text-amber-300";
  return (
    <tr className="border-b border-slate-800/50">
      <td className="px-3 py-1.5 text-slate-300">{situation}</td>
      <td className={`px-3 py-1.5 font-semibold ${color}`}>{action}</td>
    </tr>
  );
}

export default function Guide() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [search, setSearch] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  const filteredSections = useMemo(() => {
    if (!search.trim()) return SECTIONS;
    const q = search.toLowerCase();
    return SECTIONS.filter(s => s.title.toLowerCase().includes(q));
  }, [search]);

  useEffect(() => {
    if (!localStorage.getItem("hasSeenGuide")) {
      localStorage.setItem("hasSeenGuide", "true");
    }
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      entries => {
        const vis = entries.filter(e => e.isIntersecting);
        if (vis.length) setActive(vis[0].target.id);
      },
      { root: el, threshold: 0.3 }
    );
    SECTIONS.forEach(s => {
      const node = document.getElementById(s.id);
      if (node) obs.observe(node);
    });
    return () => obs.disconnect();
  }, []);

  function scrollTo(id: string) {
    const node = document.getElementById(id);
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* TOC sidebar */}
      <nav className="w-56 shrink-0 border-r border-slate-800 overflow-y-auto py-4">
        <div className="flex items-center gap-2 px-4 mb-3">
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">User Manual</span>
        </div>
        <div className="px-3 mb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="Search sections…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 h-7 text-[11px] font-mono bg-slate-900 border-slate-700 focus-visible:ring-primary/50"
            />
          </div>
        </div>
        <ul className="space-y-0.5">
          {filteredSections.length === 0 ? (
            <li className="px-4 py-2 text-[11px] text-muted-foreground font-mono">No sections match</li>
          ) : filteredSections.map(s => (
            <li key={s.id}>
              <button
                onClick={() => scrollTo(s.id)}
                className={`w-full text-left px-4 py-1.5 text-[11px] font-mono transition-colors flex items-center gap-1.5 ${
                  active === s.id
                    ? "text-primary bg-primary/10 border-r-2 border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-slate-800/40"
                }`}
              >
                {active === s.id && <ChevronRight className="w-2.5 h-2.5 shrink-0" />}
                <span className={active === s.id ? "ml-0" : "ml-3.5"}>{s.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto py-6 px-8 space-y-10">

        {/* Intro banner */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-5 py-4">
          <h1 className="text-lg font-bold font-mono text-foreground mb-1">VibeMeGood — Complete Beginner's Manual</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Brand new to sports betting? Start at the very top and read straight down. By the end you'll
            understand every number on the screen and know exactly how to build a lineup from scratch.
            No prior knowledge needed — we explain everything in plain English.
          </p>
        </div>

        {/* ════════════ PART 1 — THE BASICS ════════════ */}
        <div className="text-[10px] font-mono uppercase tracking-widest text-primary/70 border-b border-primary/20 pb-1">Part 1 — Start Here: The Basics</div>

        <Section id="what-is-betting" title="Sports Betting in Plain English">
          <p>Sports betting means putting money on a prediction about a sporting event. If your prediction is right, you win money. If it's wrong, you lose the money you put in.</p>
          <p>PrizePicks (the platform this app is built for) uses a specific, beginner-friendly style of betting called <span className="text-foreground font-semibold">player props</span> — short for "player propositions." Instead of betting on which <em>team</em> wins, you bet on what a <em>single player</em> will do: how many points they'll score, how many rebounds they'll grab, how many strikeouts a pitcher will throw, and so on.</p>
          <Callout color="primary">
            The whole game is one question, asked over and over:
            <br />"Will this player do MORE or LESS than this number?"
          </Callout>
          <p>That's it. You don't need to understand odds, spreads, or moneylines. You just answer that one question for a few players, combine your answers into an "entry," and if enough of them are correct, you get paid.</p>
          <Callout color="amber">
            <strong>Important:</strong> betting is gambling. You can and will lose. VibeMeGood improves your <em>chances</em> using math — it does not, and cannot, guarantee a win. Only ever play with money you can afford to lose completely.
          </Callout>
        </Section>

        <Section id="what-is" title="What Is VibeMeGood?">
          <p>VibeMeGood is your personal analytics workstation for PrizePicks. Think of it like the Carfax report for PrizePicks — it shows you what each prop is actually worth, compares it to what professional betting sites are offering, calculates your real chances of winning, and tells you mathematically whether a play is worth making.</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Pulls all of today's live PrizePicks props automatically</li>
            <li>Compares each prop against DraftKings, FanDuel, and ESPN Bet to find hidden value</li>
            <li>Calculates the real probability of each pick hitting</li>
            <li>Builds the best combinations of picks for you, using math (Lineup Factory)</li>
            <li>Gives you an AI analyst you can talk to like a text message</li>
            <li>Tracks your results so you improve over time</li>
          </ul>
          <Callout color="amber">
            VibeMeGood is an <strong>analysis tool</strong>. It does not place bets for you and has no access to your money. You make the final picks here, then type them into the real PrizePicks app yourself.
          </Callout>
        </Section>

        <Section id="prizepicks" title="How PrizePicks Works">
          <p>On PrizePicks you predict whether a player will go MORE or LESS than a set number in a stat category. You combine multiple predictions into one <span className="text-foreground font-semibold">entry</span>. The more picks you add, the bigger the potential payout — but the harder it is to win, because every extra pick is another thing that has to go right.</p>
          <Callout color="primary">
            Example: <strong>LeBron James — Points — 24.5</strong>. You pick MORE. If LeBron scores 25 or more, that pick wins. If he scores 24 or fewer, it loses.
          </Callout>
          <p>You typically pick between 2 and 6 players per entry. You choose a stake (how much money you're putting in), and PrizePicks shows the payout if your entry wins.</p>
        </Section>

        <Section id="projections" title="How Player Projections Work">
          <p>The "number" on each prop (the 24.5 in the LeBron example) is called the <span className="text-foreground font-semibold">line</span> or <span className="text-foreground font-semibold">projection</span>. PrizePicks sets it to be roughly the amount they expect that player to produce.</p>
          <p>Why the ".5"? The half-point removes ties. A line of 24.5 means there's no way to land exactly on it — the player either goes over (25+) or under (24 or fewer). Someone always wins.</p>
          <p>Lines move. If a star sits out, his teammate's line might rise (more opportunity). If a defense is brutal, a scorer's line might drop. VibeMeGood watches these moves and tells you when a line looks <em>too low</em> (good for MORE) or <em>too high</em> (good for LESS) compared to what professional sportsbooks think.</p>
          <Callout color="emerald">
            Your edge comes from finding lines that are <strong>mispriced</strong> — set too low or too high. VibeMeGood's entire job is to find those for you automatically.
          </Callout>
        </Section>

        <Section id="more-less" title="Picking 'More' vs. 'Less'">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded p-3">
              <div className="text-emerald-300 font-semibold mb-1">MORE (Over)</div>
              <p className="text-[11px] text-slate-300">You're betting the player <strong>beats</strong> the number. Pick this when the line looks too low — i.e. you expect the player to do better than PrizePicks is giving them credit for.</p>
            </div>
            <div className="bg-red-950/30 border border-red-800/40 rounded p-3">
              <div className="text-red-300 font-semibold mb-1">LESS (Under)</div>
              <p className="text-[11px] text-slate-300">You're betting the player <strong>falls short</strong> of the number. Pick this when the line looks too high — i.e. you expect the player to do worse than the line suggests.</p>
            </div>
          </div>
          <p>You don't have to guess which side is better — that's what True Edge and Hit Probability are for (explained in Part 2). VibeMeGood literally tells you which direction has value.</p>
        </Section>

        <Section id="power-vs-flex" title="Power Plays vs. Flex Plays">
          <p>When you submit an entry, PrizePicks asks you to choose one of two formats. This is one of the most important beginner decisions, so here it is in plain terms:</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold mb-1">⚡ Power Play</div>
              <p className="text-[11px] text-slate-400 mb-2">Every single pick must hit. Miss even one and you lose the whole entry.</p>
              <p className="text-[11px] text-emerald-400">+ Bigger payouts</p>
              <p className="text-[11px] text-red-400">− All-or-nothing, no safety net</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold mb-1">🛡️ Flex Play</div>
              <p className="text-[11px] text-slate-400 mb-2">You can miss one (sometimes two) picks and still get a partial payout.</p>
              <p className="text-[11px] text-emerald-400">+ Safer, partial wins</p>
              <p className="text-[11px] text-red-400">− Lower maximum payout</p>
            </div>
          </div>
          <Callout color="amber">Simple rule of thumb: if your entry's win probability is under 10%, use Flex for the safety net. If it's over 15%, Power is usually better mathematically. VibeMeGood shows you this win probability before you decide.</Callout>
        </Section>

        <Section id="golden-rules" title="The Golden Rules">
          <div className="space-y-4">
            <Rule n={1} title="Only play with money you can afford to lose completely.">PrizePicks is gambling. There is no guaranteed win. The app gives you an edge — a better chance — but no certainty. Never bet rent money, grocery money, or money earmarked for anything important.</Rule>
            <Rule n={2} title="Treat it like a business, not a thrill.">The players who make consistent money approach this calmly and methodically. They don't chase losses. They don't double up after a bad day. They follow the math.</Rule>
            <Rule n={3} title="Small stakes, steady habits beat big swings.">A player betting $10/day with smart picks will outperform a player betting $100 randomly. Consistency compounds.</Rule>
            <Rule n={4} title="The app helps you find edges, not guarantees.">Even a 65% probability means you lose 35% of the time. That's 1 in 3 picks. Don't panic when you're right but still lose.</Rule>
            <Rule n={5} title="Set a daily loss limit before you play.">Decide your number before the day starts — "if I lose $X today, I'm done." If you hit it, you stop. No exceptions.</Rule>
          </div>
        </Section>

        {/* ════════════ PART 2 — HOW TO READ THE METRICS ════════════ */}
        <div className="text-[10px] font-mono uppercase tracking-widest text-primary/70 border-b border-primary/20 pb-1">Part 2 — How to Read the Metrics</div>

        <Section id="metrics-intro" title="How to Read the Metrics">
          <p>VibeMeGood's whole purpose is to take the complicated math that professional bettors use and turn it into a few simple, color-coded numbers. You don't need to do any calculations — you just need to know what each number means and what to do about it. Here's every metric you'll see, in plain English.</p>
          <Callout color="emerald">
            The shortcut: <strong>green = good for you, red = avoid, higher numbers = stronger.</strong> Read on to understand <em>why</em>.
          </Callout>
        </Section>

        <Section id="line-types" title="Line Types: Standard, Goblin & Demon">
          <p>PrizePicks marks some lines with little icons. Knowing them is the single fastest way to spot a good or bad pick.</p>
          <p><span className="text-foreground font-semibold">Standard Lines</span> — Normal lines set close to what PrizePicks expects. Roughly a coin flip (≈52%) whether you win.</p>
          <Callout color="emerald">
            <strong>🟢 Goblin Lines</strong> — Set <em>lower</em> than normal — PrizePicks is handing you a discount. The OVER hits about 65% of the time. These are your best friends for Power Plays. The payout multiplier is slightly smaller, but the higher win rate more than makes up for it.
          </Callout>
          <Callout color="red">
            <strong>🔴 Demon Lines</strong> — Set <em>higher</em> than normal. NEVER play a Demon OVER — it only hits ~35% of the time, so you'll lose far more than you win. (The flip side: a Demon UNDER hits ~65%, so if the line is clearly inflated, the LESS side can have value.)
          </Callout>
        </Section>

        <Section id="true-edge" title="True Edge — Your #1 Number">
          <p><span className="text-foreground font-semibold">True Edge %</span> is the most important number in the app. It tells you how much better (or worse) PrizePicks' line is compared to the professional books — DraftKings, FanDuel, and ESPN Bet.</p>
          <p className="font-mono bg-slate-800 rounded px-3 py-2 text-foreground">True Edge = (Market Line − PP Line) ÷ Market Line × 100</p>
          <p>In plain English: the pros have spent millions making their lines accurate. If PrizePicks is offering you a player at a lower number than the pros use, you're getting a deal — and that shows up as positive (green) True Edge.</p>
          <div className="space-y-1">
            <p><span className="text-emerald-400 font-semibold">Positive (green)</span> — PP's line is lower than the market → the MORE side has value</p>
            <p><span className="text-red-400 font-semibold">Negative (red)</span> — PP's line is higher than the market → skip, or consider LESS</p>
            <p><span className="text-slate-400 font-semibold">Zero</span> — PP and the market agree → no edge either way</p>
          </div>
        </Section>

        <Section id="hit-prob" title="Hit Probability">
          <p>Every pick shows a <span className="text-foreground font-semibold">Hit Probability</span> — the app's calculated chance that the pick wins. This is built from the player's recent game logs, the matchup, injuries, and how the line compares to the market.</p>
          <p>Here's the key beginner insight: for a Power Play, you have to multiply the picks together, because they all have to hit. A 4-pick Power looks like this:</p>
          <div className="font-mono bg-slate-800 rounded px-3 py-2 space-y-0.5 text-foreground">
            <div>4 Goblin picks (65% each): 0.65⁴ = <span className="text-primary">17.9%</span></div>
            <div>Mixed picks (58%, 65%, 52%, 58%): <span className="text-amber-300">11.4%</span></div>
          </div>
          <p>This is why pick quality matters so much: every weak pick drags your whole entry down. VibeMeGood does this multiplication for you and shows the combined win probability in the Entry Builder and Lineup Factory.</p>
        </Section>

        <Section id="market-lines" title="Market Lines">
          <p>The <span className="text-foreground font-semibold">Market Lines</span> panel shows how PrizePicks compares to DraftKings, FanDuel, and ESPN Bet for the same player. These books set extremely accurate lines, so when PrizePicks disagrees with them, that gap is your opportunity.</p>
          <Callout color="primary">Think of it like comparing prices. If Best Buy sells a TV for $800 but Amazon has it for $600, you buy from Amazon. When PrizePicks "prices" a player lower than the pro books, that's your edge — and the app highlights it for you.</Callout>
        </Section>

        <Section id="ev" title="Expected Value (EV)">
          <p><span className="text-foreground font-semibold">Expected Value</span> answers: "If I made this exact bet hundreds of times, would I come out ahead?" <span className="text-emerald-400 font-semibold">Positive EV</span> = you profit over the long run. <span className="text-red-400 font-semibold">Negative EV</span> = you bleed money over time, even if individual bets sometimes win.</p>
          <div className="font-mono bg-slate-800 rounded px-3 py-2 text-foreground">
            EV = (Chance of winning × Payout) − (Chance of losing × Stake)<br />
            4-pick Goblin Power, $25: (0.179 × $250) − (0.821 × $25) = <span className="text-emerald-400">+$24.22</span>
          </div>
          <p>That positive number is the whole reason to use Goblin lines. Compare a standard 4-pick at 50% each: EV = <span className="text-red-400">−$7.81</span>. Same format, but negative — which is exactly why most casual PrizePicks players slowly lose. Always aim for green EV.</p>
        </Section>

        <Section id="best-value" title="The ★ BEST VALUE Badge">
          <p>Most players show up on the Slate Board more than once — the same player and stat can have a <strong>Standard</strong>, a <strong>Goblin</strong>, and a <strong>Demon</strong> line all at the same time. They look different, but you can usually only afford to use one. So which is the best deal?</p>
          <p>The app answers that for you. For each player+stat, it compares the three tiers on <span className="text-foreground font-semibold">expected value</span> — the hit probability of each tier multiplied by what that tier pays — and stamps a gold <span className="font-mono text-yellow-300">★ BEST</span> badge on the single tier with the highest expected value. The badge also tells you which side to take (<span className="font-mono">OVER</span> or <span className="font-mono">UNDER</span>), and the detail sheet's <span className="text-foreground font-semibold">Risk Ladder</span> shows the EV number for every tier side-by-side.</p>
          <Callout color="amber">Important: the badge only compares the tiers <em>against each other</em> — it does not mean the play is automatically good. A line can be the best of three bad options. Still check that its True Edge and EV are green before you commit. By default the app leans toward the safer Standard or Goblin tier; it only crowns a Demon when its payout genuinely outweighs the lower hit rate.</Callout>
        </Section>

        <Section id="kelly" title="Kelly Criterion (Bet Sizing)">
          <p>The <span className="text-foreground font-semibold">Kelly Criterion</span> is a formula that calculates the smartest amount to stake based on how big your edge is. Bigger edge → bet a little more; smaller edge → bet less. The app does this math for you and shows a recommended stake.</p>
          <p>VibeMeGood defaults to <span className="text-foreground font-semibold">Quarter Kelly (0.25)</span> — it recommends just 25% of what the raw formula suggests. Why? Because your probabilities are smart estimates, not certainties, and betting the full amount is dangerously aggressive. Quarter Kelly is the professional standard for staying safe while still growing.</p>
        </Section>

        {/* ════════════ PART 3 — THE DAILY WORKFLOW ════════════ */}
        <div className="text-[10px] font-mono uppercase tracking-widest text-primary/70 border-b border-primary/20 pb-1">Part 3 — Step-by-Step: From Empty Screen to Submitted Lineup</div>

        <Section id="workflow" title="Daily Workflow, Start to Finish">
          <p>This is the exact routine to follow every day. Work top to bottom — it takes about 10 minutes once you're comfortable.</p>
          <div className="mt-4">
            <Step n={1} title="Open the Command Center and check today's slate">
              <p>The <span className="text-foreground font-semibold">Command Center</span> (the home screen) loads the moment you open the app. It shows today's games, how many props are live, your watched players, and any injury alerts. If numbers look empty or stale, go to <span className="text-foreground font-semibold">Settings → Sync All</span> to pull the latest data, then come back.</p>
              <p>A "slate" just means all of the games (and their props) available for a given day. The top of the Command Center surfaces the strongest plays the app has already found — a great starting shortlist.</p>
            </Step>
            <Step n={2} title="Scan the Slate Board for value">
              <p>Open the <span className="text-foreground font-semibold">Slate Board</span>. This is the full table of every player prop. Use the filters at the top:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Pick the <strong>sport</strong> you want (e.g. NBA, WNBA, MLB).</li>
                <li>Set a <strong>minimum edge</strong> so only worthwhile props show.</li>
                <li>Sort by <strong>True Edge</strong> so the best deals float to the top.</li>
              </ul>
              <p>Look for <span className="text-emerald-400">green True Edge</span> and <span className="text-emerald-400">Goblin</span> lines. Click any row to open the detail sheet, and click the star to add a player to your <strong>watchlist</strong>.</p>
            </Step>
            <Step n={3} title="Analyze the matchups">
              <p>Before committing, sanity-check the context. Open <span className="text-foreground font-semibold">Matchup Analysis</span> to see how each player has performed head-to-head against tonight's opponent. Then, back on the <span className="text-foreground font-semibold">Slate Board</span>, glance at each pick's <strong>Hit Probability</strong> and its <strong>line-movement</strong> indicator — if the line moved against your side, sharp money disagrees, so be cautious.</p>
            </Step>
            <Step n={4} title="Check injuries — every time, no exceptions">
              <p>Open <span className="text-foreground font-semibold">Injuries &amp; News</span> within 30 minutes of game time for every player you're considering. <span className="text-red-400 font-semibold">OUT</span> = never play them. <span className="text-amber-300 font-semibold">GTD</span> (game-time decision) = wait for lineup confirmation, and never put a GTD player in a Power Play.</p>
            </Step>
            <Step n={5} title="Build your lineup — automatically or by hand">
              <p>You have two ways to assemble the final picks:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li><strong>Lineup Factory</strong> (recommended for beginners) — the app builds the mathematically best lineups for you. See the next section.</li>
                <li><strong>Entry Builder</strong> — add picks yourself one at a time and watch the live math. See below.</li>
              </ul>
            </Step>
            <Step n={6} title="Review the win probability and EV">
              <p>Whichever path you took, look at two numbers before you commit: the entry's <strong>combined win probability</strong> and its <strong>Expected Value (EV)</strong>. You want positive (green) EV. If the win probability is low, switch to a <strong>Flex</strong> format for the safety net.</p>
            </Step>
            <Step n={7} title="Submit the lineup on PrizePicks">
              <p>VibeMeGood doesn't place bets. Open the real <strong>PrizePicks app or website</strong> and re-create the exact same picks, direction (More/Less), format (Power/Flex), and stake.</p>
            </Step>
            <Step n={8} title="Log it in the Journal and review later">
              <p>Come back to VibeMeGood and log the entry in the <span className="text-foreground font-semibold">Journal</span>. After the games finish, grade it (win/loss). Over time the <strong>Review</strong> and <strong>CLV Tracker</strong> pages turn your history into the feedback that makes you a better player.</p>
            </Step>
          </div>
        </Section>

        <Section id="lineup-factory" title="Lineup Factory — Auto-Build the Best Lineup">
          <p>The <span className="text-foreground font-semibold">Lineup Factory</span> is the easiest way to "generate the mathematically highest-probability lineup." Instead of hand-picking players, you tell it your preferences and it searches every available prop to assemble the strongest combinations for you, ranked by win probability and EV.</p>
          <p>Set these controls, then press <span className="text-foreground font-semibold">Generate</span>:</p>
          <div className="space-y-2">
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">Entry Type</div>
              <div className="text-[11px] text-slate-400">Power, Flex, Stack, or Team+Player. Beginners: start with Power or Flex.</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">Picks per entry &amp; number of entries</div>
              <div className="text-[11px] text-slate-400">How many players in each lineup (2–6) and how many lineups to build at once.</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">Variance Profile</div>
              <div className="text-[11px] text-slate-400">Conservative (safest, lower payout) → Balanced → Aggressive → Chaos (boom-or-bust). Beginners: Conservative or Balanced.</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">Optimization Objective</div>
              <div className="text-[11px] text-slate-400">What the math should chase — e.g. balanced growth. This is the "highest-probability" engine doing the heavy lifting.</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">Stake &amp; Exposure Limits</div>
              <div className="text-[11px] text-slate-400">How much to risk per entry, and caps so you don't over-rely on any single player, pick, team, or game across multiple lineups.</div>
            </div>
          </div>
          <Callout color="primary">The Factory returns finished lineups with their win probability and EV already calculated. Pick the one you like best, then move to submitting it on PrizePicks.</Callout>
        </Section>

        <Section id="entry-builder" title="Entry Builder (Manual Build)">
          <p>Prefer to choose your own players? The <span className="text-foreground font-semibold">Entry Builder</span> is your manual workspace. Add picks from the Slate Board and it shows everything live: each pick's hit probability and direction, the market edge, and a full payout calculator.</p>
          <p>The <span className="text-foreground font-semibold">EV Panel</span> displays Win Probability, Expected Value, ROI, the Probability Chain, and a Kelly stake recommendation. A <span className="text-foreground font-semibold">Correlation Warning</span> appears if you pick two players from the same team — teammates share the same stat pool, which makes the entry riskier than it looks.</p>
        </Section>

        <Section id="submit" title="Submitting on PrizePicks">
          <p>VibeMeGood is for analysis only — it never touches your money or places bets. When your lineup is ready here, open the official PrizePicks app or website and re-enter it manually.</p>
          <Callout color="amber">Double-check four things match exactly: the <strong>players</strong>, the <strong>direction</strong> (More/Less), the <strong>format</strong> (Power/Flex), and the <strong>stake</strong>. Then submit on PrizePicks and log it back here in the Journal.</Callout>
        </Section>

        {/* ════════════ PART 4 — TOOLS, TRACKING & DISCIPLINE ════════════ */}
        <div className="text-[10px] font-mono uppercase tracking-widest text-primary/70 border-b border-primary/20 pb-1">Part 4 — Tools, Tracking &amp; Discipline</div>

        <Section id="ai-analyst" title="AI Analyst">
          <p>The AI Analyst is powered by Claude. Think of it as having a sports analytics expert on speed dial — with live access to today's slate, your watchlist, injuries, and recent results.</p>
          <p>What you can ask:</p>
          <ul className="space-y-0.5 list-disc list-inside">
            <li>"Is Anthony Davis's points line good value today?"</li>
            <li>"What's the best 4-pick power play today?"</li>
            <li>"My picks are [X, Y, Z] — are they correlated?"</li>
            <li>"Analyze my current entry"</li>
            <li>"What's the weakest pick in my lineup?"</li>
          </ul>
        </Section>

        <Section id="injuries" title="Injuries & News">
          <p>Check the Injuries page within 30 minutes of game time for any player you're picking.</p>
          <div className="space-y-1">
            <Callout color="red"><strong>OUT</strong> — Do not play any prop for this player. Period.</Callout>
            <Callout color="amber"><strong>GTD</strong> — Game-Time Decision. Wait until the lineup is confirmed. If confirmation hasn't posted, skip.</Callout>
            <Callout color="emerald"><strong>ACTIVE</strong> — Cleared to play.</Callout>
          </div>
          <p>Quick rule: if a player is GTD and you haven't seen lineup confirmation, do NOT include them in a Power Play. Put them in Flex at most.</p>
        </Section>

        <Section id="review" title="Performance Review">
          <p>The Review page tracks every entry you've logged. Key metrics and the targets to aim for:</p>
          <div className="grid grid-cols-2 gap-2">
            {[["Total P&L","Positive and growing"],["Entry Hit Rate","Above 25% for 4-pick power"],["Pick Hit Rate","Above 55%"],["Avg CLV","Positive = good process"],["ROI","Positive long-term"]].map(([m,g]) => (
              <div key={m} className="bg-slate-800/50 rounded p-2">
                <div className="font-semibold text-foreground">{m}</div>
                <div className="text-slate-400 text-[11px]">{g}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="clv-guide" title="CLV — The Professional Standard">
          <p>CLV (Closing Line Value) measures whether the line moved in your favour after you locked in your pick. If you take Davis OVER 26.5 and it later moves to 27.5, your CLV is +1.0 — you got a better price than the final market.</p>
          <Callout color="primary">Consistent positive CLV means your process is good, even during losing stretches. It's the most reliable proof that your edge is real, not just luck.</Callout>
          <p>View your CLV history and trend chart on the CLV Tracker page. It's recorded automatically when you grade picks in the Journal.</p>
        </Section>

        <Section id="bankroll" title="Bankroll Management 101">
          <div className="space-y-2">
            <Rule n={1} title="Never risk more than 5% on any single entry.">If you have $500, max entry is $25. If you have $100, max is $5.</Rule>
            <Rule n={2} title="Set a daily loss limit before you play.">Decide: "If I lose $X today, I stop." Stick to it. Tilt is the #1 killer of bankrolls.</Rule>
            <Rule n={3} title="Don't increase stakes after wins.">Let the bankroll grow slowly. Doubling up after a win usually gives it all back.</Rule>
            <Rule n={4} title="Keep records of everything.">The app does this for you — but you have to log your entries. Without data, you're flying blind.</Rule>
            <Rule n={5} title="Give yourself at least 200 entries before judging.">Variance is brutal in the short term. A player with a real edge can still have a terrible 30-entry stretch.</Rule>
          </div>
        </Section>

        <Section id="mistakes" title="Common Mistakes">
          <div className="space-y-2">
            {[
              ["Playing Demon OVER lines", "35% hit rate. You lose 65% of the time. Filter the Slate Board to hide Demons."],
              ["Stacking teammates", "They share the same stat pool. The app warns you automatically. Heed the warning."],
              ["Ignoring injuries in a Power Play", "If they scratch, you lose everything. Check Injuries 30 minutes before tip-off."],
              ["Playing on gut feeling", "Your gut doesn't know what DraftKings is pricing the line at. Always check True Edge first."],
              ["Chasing losses by increasing stake", "Decide a daily loss limit before you start. When you hit it, close the app."],
              ["Too many picks in a Power Play", "A 6-pick Power at 60% each is only 4.7%. Stick to 3–4 picks."],
              ["Ignoring line movement", "If the line moved against you, sharp money may disagree. Check the line-move indicator."],
            ].map(([t, d]) => (
              <div key={t} className="bg-slate-900 border border-slate-800 rounded p-3">
                <div className="text-red-400 font-semibold text-xs mb-0.5">✕ {t}</div>
                <div className="text-slate-400 text-xs">{d}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="glossary" title="Beginner's Glossary">
          <p className="mb-1">Every term in the app, defined in one line. When something on screen confuses you, look it up here.</p>
          <div className="space-y-2">
            {[
              ["Bankroll", "Total money set aside for PrizePicks. Never your total savings."],
              ["CLV", "Closing Line Value. How much the line moved between when you picked and game time. Positive = you got a better price."],
              ["Demon Line", "A PP line set higher than market consensus. OVER is a trap; UNDER can have value."],
              ["Edge", "Your mathematical advantage over PrizePicks. Positive = you expect to profit."],
              ["Entry", "Your full lineup of picks submitted to PrizePicks."],
              ["EV", "Expected Value. How much you'll win or lose on average per bet if repeated many times."],
              ["Flex Play", "Entry type where you can miss one or two picks and still get a partial payout."],
              ["Goblin Line", "A PP line set lower than market consensus. OVER has value, hits ~65%."],
              ["Hit Probability / Hit Rate", "The chance a pick wins. Goblin ≈ 65%, Standard ≈ 52%, Demon OVER ≈ 35%."],
              ["Kelly Criterion", "Formula that calculates the optimal stake based on your edge and payout odds."],
              ["Line / Projection", "The number a player must beat (More) or fall short of (Less)."],
              ["Line Movement", "When the line changes between posting and game time. Sharp money moves lines."],
              ["Lineup Factory", "VibeMeGood's auto-builder that generates the highest-probability lineups for you."],
              ["Market Line", "Average line across DraftKings, FanDuel, and ESPN Bet."],
              ["More / Less (Over / Under)", "Your prediction that a player goes above (More) or below (Less) the line."],
              ["Player Prop", "A bet on one player's stat, not on which team wins."],
              ["Power Play", "Entry type where every single pick must hit to win. Higher payouts."],
              ["Sharp", "A sophisticated, math-driven bettor who focuses on edge."],
              ["Slate", "All the games and props available on a given day."],
              ["Stack", "Picking two or more players from the same team. Riskier because their stats are linked."],
              ["Stake", "The amount of money you put into an entry."],
              ["True Edge", "Percentage difference between PP's line and the market average. Positive = MORE has value."],
              ["Unit", "Your standard bet size, usually 3–5% of your bankroll."],
              ["Variance", "Natural randomness in outcomes. Even a 70% pick loses 30% of the time."],
            ].map(([term, def]) => (
              <div key={term} className="flex gap-3">
                <span className="font-semibold text-primary shrink-0 w-32">{term}</span>
                <span className="text-muted-foreground">{def}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Quick reference cheat sheet */}
        <Section id="cheatsheet" title="Quick Reference Cheat Sheet">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-3 py-1.5 text-muted-foreground font-mono">Situation</th>
                <th className="text-left px-3 py-1.5 text-muted-foreground font-mono">Action</th>
              </tr>
            </thead>
            <tbody>
              <QR situation="Goblin line OVER" action="Play — 65% hit rate" />
              <QR situation="Demon line OVER" action="Skip — 35% hit rate" />
              <QR situation="Demon line UNDER" action="Play — 65% hit rate" />
              <QR situation="True Edge > +5%" action="Strong play" />
              <QR situation="True Edge 0–5%" action="Weak play — only with other factors" />
              <QR situation="True Edge negative" action="Skip or play UNDER" />
              <QR situation="Player is GTD" action="Flex only, not Power" />
              <QR situation="Player is OUT" action="Never play" />
              <QR situation="Teammates stacked" action="Warning — avoid if possible" />
              <QR situation="Line moved against you" action="Be cautious — sharp money disagrees" />
              <QR situation="EV is positive" action="Mathematically sound play" />
              <QR situation="EV is negative" action="Bad play long-term, even if it feels right" />
              <QR situation="Win probability under 10%" action="Switch to Flex" />
              <QR situation="Win probability over 15%" action="Power is fine" />
              <QR situation="Slate Board pick has edge ≥ 30%" action="Strong PLAY — top 20% model confidence" />
              <QR situation="Slate Board pick has edge ≥ 35%" action="Strong PLAY — top 10%, 87%+ historical hit rate" />
              <QR situation="Slate Board pick has edge < 5%" action="Skip or proceed with caution only" />
              <QR situation="Model Audit ECE < 3%" action="Probabilities are trustworthy" />
              <QR situation="Model Audit CHR > 70%" action="Confident picks are performing well" />
            </tbody>
          </table>
        </Section>

        {/* ════════════ PART 5 — UNDER THE HOOD ════════════ */}
        <div className="text-[10px] font-mono uppercase tracking-widest text-primary/70 border-b border-primary/20 pb-1">Part 5 — Under the Hood: How the Model Works</div>

        <Section id="model-audit-intro" title="The Model Audit — What It Is">
          <p>Navigate to <span className="text-foreground font-semibold">Model Audit</span> in the sidebar. This page answers a question that most betting tools never even ask: <em>"Is this app's math actually correct?"</em></p>
          <p>Every time you press <span className="text-foreground font-semibold">Run Audit</span>, the system replays thousands of historical games — pretending it's making fresh predictions using only information that was available before each game started. It then compares those predictions to what actually happened. This is called a <span className="text-foreground font-semibold">walk-forward backtest</span>, and it's the gold standard for validating a predictive model.</p>
          <Callout color="primary">
            Think of it like this: the app gave you a "60% likely" prediction for a player. After thousands of those predictions, did the ones labeled 60% actually hit 60% of the time? If yes, the model is <strong>calibrated</strong> — it's honest about its own uncertainty. The audit measures that honesty six different ways.
          </Callout>
          <p>The audit page has six tiers, each measuring a different aspect of the model's performance. You don't need to understand the math — just know what each verdict means for you as a bettor.</p>
        </Section>

        <Section id="model-health" title="Model Health Metrics Explained">
          <p>The Overview card at the top of the Audit page shows four numbers. Here's what each one means:</p>
          <div className="space-y-3">
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-1">Brier Score <span className="text-muted-foreground font-normal">(lower = better, target: below 0.22)</span></div>
              <p className="text-[11px] text-slate-400">The average squared error of every probability prediction. A coin flip (50/50 guessing) scores about 0.25. A Brier below 0.22 means the model is meaningfully better than random. The current model scores <span className="text-emerald-400 font-semibold">0.2099</span> — a strong result across 36,000+ predictions.</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-1">Conf. Hit Rate (CHR) <span className="text-muted-foreground font-normal">(higher = better, target: above 70%)</span></div>
              <p className="text-[11px] text-slate-400">When the model is <em>confident</em> — meaning it says the probability is at least 60% or at most 40% — what percentage of those picks actually hit? A CHR above 70% means confident picks are reliably strong. Current: <span className="text-emerald-400 font-semibold">74.9%</span>.</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-1">ECE — Expected Calibration Error <span className="text-muted-foreground font-normal">(lower = better, target: below 3%)</span></div>
              <p className="text-[11px] text-slate-400">If the model says "65% likely," it should hit 65% of the time — not 55%, not 80%. ECE measures how far off those labels are on average across all probability buckets. Under 3% means the model's percentages can be trusted at face value. Current: <span className="text-emerald-400 font-semibold">2.0%</span> — well-calibrated.</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-1">Max Cal Error <span className="text-muted-foreground font-normal">(lower = better, target: below 20%)</span></div>
              <p className="text-[11px] text-slate-400">The <em>worst</em> individual probability bucket. Even if the average error is tiny, one bucket might be badly miscalibrated. Under 20% means the worst-case bucket is still acceptable. Current: <span className="text-yellow-400 font-semibold">16.0%</span>.</p>
            </div>
          </div>
          <Callout color="emerald">
            <strong>Bottom line for bettors:</strong> an ECE of 2.0% means when the app tells you a pick is 70% likely, it really is 70% likely — not 60%, not 80%. You can trust the numbers as actual probabilities, not just rankings.
          </Callout>
        </Section>

        <Section id="tier1-factor" title="Tier 1 — Factor Audit">
          <p>The model considers many "factors" that might shift a prediction — days of rest, back-to-back games, pace of play, and others. Tier 1 tests each factor individually: does including it improve predictions or hurt them?</p>
          <div className="space-y-1">
            <p><span className="text-emerald-400 font-semibold">KEEP</span> — the factor genuinely improved Brier score by more than 0.0005. It belongs in the model.</p>
            <p><span className="text-red-400 font-semibold">REMOVE</span> — the factor made predictions worse. It was over-fitting to noise.</p>
            <p><span className="text-slate-400 font-semibold">NEUTRAL</span> — the delta was too small to matter either way.</p>
          </div>
          <p className="text-[11px]">You don't need to act on this. It's the model's internal report card — information that helps us keep improving the predictions you rely on.</p>
        </Section>

        <Section id="tier2-stat" title="Tier 2 — Stat Audit">
          <p>Different stat types are harder or easier to predict. Points are volatile. Blocked shots are sparse and spiky. Rebounds sit somewhere in between. Tier 2 breaks down model performance by every stat type so you can see which ones the model handles well.</p>
          <p>Higher Brier = harder to predict. Lower ECE = better calibrated. If a stat type has a very high Brier score (above 0.26), treat the model's picks in that stat category with extra caution — the uncertainty is genuine.</p>
          <Callout color="amber">
            Practical use: if you're choosing between two similarly-edged picks and one involves a hard-to-predict stat (e.g. Hits+Runs+RBIs vs. Points), the points pick is more reliably modeled. Tier 2 tells you which stat types to trust most.
          </Callout>
        </Section>

        <Section id="tier3-sport" title="Tier 3 — Sport Audit">
          <p>Same idea as Tier 2, but at the sport level. Some sports have more regular data patterns than others. The audit shows which sports the model handles best so you can calibrate your confidence by sport.</p>
          <p>Sports with fewer games or sparser stat history will tend to have higher Brier scores — that's expected, not a bug. The model is more honest in those cases.</p>
        </Section>

        <Section id="tier4-edge" title="Tier 4 — Edge Audit">
          <p>This is where the model's honesty test gets practical. The Edge Audit groups all predictions into five buckets based on how confident the model was:</p>
          <div className="font-mono bg-slate-800 rounded px-3 py-2 space-y-0.5 text-foreground text-[11px]">
            <div><span className="text-muted-foreground w-16 inline-block">0–5%</span> Very low confidence — basically a coin flip</div>
            <div><span className="text-muted-foreground w-16 inline-block">5–10%</span> Slight lean</div>
            <div><span className="text-muted-foreground w-16 inline-block">10–15%</span> Meaningful edge</div>
            <div><span className="text-muted-foreground w-16 inline-block">15–20%</span> Strong edge</div>
            <div><span className="text-muted-foreground w-16 inline-block">20%+</span> High confidence</div>
          </div>
          <p>Edge = how far the model's probability is from 50%. A prediction of 70% has a 20% edge (70 − 50 = 20). A prediction of 45% has a 5% edge on the <em>under</em> side (50 − 45 = 5).</p>
          <p>The key question: does higher edge → higher hit rate? If the answer is yes (monotonically increasing), the model is coherent — it really is more confident when it should be. Any row marked <span className="text-red-400">⚠ inversion</span> means the model was over-confident at that level.</p>
        </Section>

        <Section id="tier5-roi" title="Tier 5 — ROI & CLV Audit">
          <p>Tier 5 translates model confidence into dollar terms. It simulates making a flat $1 bet on every single prediction — always betting in the direction the model favors — and measures what would have happened.</p>
          <div className="space-y-2">
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">Predicted ROI</div>
              <p className="text-[11px] text-slate-400">What the model's own math says you <em>should</em> earn per dollar. A model predicting 60% confident = +20% predicted ROI per bet.</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">Realized ROI</div>
              <p className="text-[11px] text-slate-400">What <em>actually</em> happened. If picks in a bucket hit 60% of the time with flat $1 bets, realized ROI = +20%. This is real-world performance.</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-0.5">CLV (Model CLV)</div>
              <p className="text-[11px] text-slate-400">Realized ROI minus Predicted ROI. Positive CLV = the model was <em>too modest</em> — picks outperformed their predicted value. Negative CLV = the model over-estimated its own edge. Near-zero CLV at high edge buckets is ideal.</p>
            </div>
          </div>
          <Callout color="emerald">
            <strong>What it showed:</strong> every single edge bucket has positive realized ROI — from +1.2% at 0–5% edge to +66.7% at 20%+ edge. ROI increases monotonically with edge. The model's signals genuinely translate to money.
          </Callout>
          <p>The σ (sigma) column shows variance — the spread of outcomes. High σ at low-edge buckets is expected (near-coin-flip outcomes are noisy). The σ <em>shrinks</em> as edge grows, meaning high-edge picks are not only more profitable but more consistent.</p>
        </Section>

        <Section id="tier5a-decile" title="Tier 5A — Edge Decile Audit">
          <p>Tier 5A is the most actionable section in the entire audit. It addresses the question Tier 5 couldn't: the old "20%+ bucket" contained 11,475 predictions. Were they all equally good? No — and now we can see exactly how they differ.</p>
          <p>Instead of fixed percentage bands, Tier 5A uses <span className="text-foreground font-semibold">rank-based bands</span> computed fresh every audit run:</p>
          <div className="font-mono bg-slate-800 rounded px-3 py-2 space-y-1 text-[11px]">
            <div className="flex gap-4">
              <span className="text-primary font-semibold w-20">Top 1%</span>
              <span className="text-foreground">The 1% of all predictions where the model was most confident</span>
            </div>
            <div className="flex gap-4">
              <span className="text-primary font-semibold w-20">Top 5%</span>
              <span className="text-foreground">Predictions from the 95th to 99th percentile of confidence</span>
            </div>
            <div className="flex gap-4">
              <span className="text-primary font-semibold w-20">Top 10%</span>
              <span className="text-foreground">90th to 95th percentile</span>
            </div>
            <div className="flex gap-4">
              <span className="text-primary font-semibold w-20">Top 20%</span>
              <span className="text-foreground">80th to 90th percentile</span>
            </div>
            <div className="flex gap-4">
              <span className="text-muted-foreground font-semibold w-20">Rest</span>
              <span className="text-muted-foreground">The bottom 80% — lowest-confidence predictions</span>
            </div>
          </div>

          <p>The <span className="text-foreground font-semibold">Threshold</span> column answers a critical question: "What edge number on the Slate Board does this tier start at?" For example, if the Top 10% threshold is ≥ 34.6%, any pick on the Slate Board showing 35% edge or higher is historically in the top 10% of model confidence — and has hit at 87.7%.</p>
          <p>The <span className="text-foreground font-semibold">% of all</span> column answers the volume question: of every prediction the model makes, what share falls into this band? Top 1% = 1% of picks. If you run 200 predictions on a given day, that's roughly 2 picks in the Top 1% tier.</p>

          <Callout color="emerald">
            <strong>What it currently shows:</strong>
            <div className="mt-1 space-y-0.5">
              <div>Top 1% (≥ 49% edge) → <strong>98.4% hit rate, +96.8% ROI</strong></div>
              <div>Top 10% (≥ 34.6% edge) → <strong>87.7% hit rate, +75.4% ROI</strong></div>
              <div>Top 20% (≥ 30.1% edge) → <strong>82.7% hit rate, +65.4% ROI</strong></div>
              <div>Rest (below 30.1%) → 58.0% hit rate, +16.0% ROI</div>
            </div>
          </Callout>
          <p>The thresholds are recalculated each time you run the audit — they're data-driven, not fixed. If the model's edge distribution shifts as more data comes in, so does the threshold.</p>
        </Section>

        <Section id="what-edge-means" title="What 'Edge' Means on the Slate Board">
          <p>On the <span className="text-foreground font-semibold">Slate Board</span>, every pick shows an edge percentage. This is the same number the Model Audit uses — it directly corresponds to the Tier 5A bands.</p>
          <div className="font-mono bg-slate-800 rounded px-3 py-2 text-[11px] space-y-1">
            <div className="text-muted-foreground mb-1">Edge = |model probability − 50%|</div>
            <div>Model says 70% likely → <span className="text-primary">20% edge</span></div>
            <div>Model says 85% likely → <span className="text-primary">35% edge</span></div>
            <div>Model says 99% likely → <span className="text-primary">49% edge</span></div>
            <div>Model says 55% likely → <span className="text-primary">5% edge</span> (same for 45% on the under)</div>
          </div>
          <p>A pick can be an over <em>or</em> an under — the model always surfaces the direction it believes in (the one above 50%). The edge number tells you how strongly it believes.</p>
          <Callout color="primary">
            Connecting Slate Board to Tier 5A: if you see a Slate Board pick with 35% edge, that pick is historically in the <strong>Top 10%</strong> tier — where the realized hit rate has been 87.7%. That's the single most useful thing the audit tells a daily bettor.
          </Callout>
        </Section>

        <Section id="threshold-guide" title="Choosing Your Edge Threshold">
          <p>The audit data lets you make a principled decision about which picks to play. Here's how to think about the trade-off:</p>
          <div className="space-y-2">
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded p-3">
              <div className="text-emerald-300 font-semibold text-xs mb-1">High threshold (≥ 35% edge) — Quality over volume</div>
              <p className="text-[11px] text-slate-300">You play only top-10% picks. Hit rate historically ~87%+. You'll see fewer qualifying picks per day — maybe 2–5. But those picks are near-certainties by historical standards. Best strategy if you have a limited daily budget or want maximum confidence per pick.</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-foreground font-semibold text-xs mb-1">Mid threshold (≥ 30% edge) — Balanced</div>
              <p className="text-[11px] text-slate-400">Top-20% picks. Hit rate ~83%. More volume — maybe 5–10 qualifying picks per day. Still strong hit rates. Good for building Power Plays from the strongest available options. This is the recommended daily filter.</p>
            </div>
            <div className="bg-amber-950/30 border border-amber-800/40 rounded p-3">
              <div className="text-amber-300 font-semibold text-xs mb-1">Low threshold (≥ 10% edge) — Broad net</div>
              <p className="text-[11px] text-slate-300">Opens up the top 40% or so of picks. More options to work with, but lower average hit rates (~70–75%). Useful when you need more picks to fill a specific lineup size, or when the high-edge pool is small on a given day.</p>
            </div>
            <div className="bg-red-950/20 border border-red-900/30 rounded p-3">
              <div className="text-red-400 font-semibold text-xs mb-1">No threshold (or &lt; 5% edge) — Avoid</div>
              <p className="text-[11px] text-slate-400">The "Rest" band in the audit covers the bottom 80% of picks. Hit rate is 58%, ROI is +16% — positive, but noisy. At this level, one bad stretch easily wipes out the edge. Don't build Power Plays around these picks.</p>
            </div>
          </div>
          <Callout color="amber">
            <strong>The volume question:</strong> thresholds are meaningless without volume. Run the audit, check the Tier 5A table, and read the "% of all" column for your chosen threshold. If Top 10% = 5% of all predictions and you see ~100 picks per day, that's 5 qualifying picks daily — enough to build a solid 2–3 pick Power Play every day.
          </Callout>
          <p>Re-run the audit every few weeks. As more game data arrives, the thresholds shift and the hit rates update. The Tier 5A table always reflects the freshest available evidence.</p>
        </Section>

      </div>
    </div>
  );
}
