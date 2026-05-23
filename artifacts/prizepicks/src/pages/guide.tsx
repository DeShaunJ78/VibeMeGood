import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight } from "lucide-react";

const SECTIONS = [
  { id: "what-is",        title: "What Is VibeMeGood?" },
  { id: "prizepicks",     title: "What Is PrizePicks?" },
  { id: "golden-rules",   title: "The Golden Rules" },
  { id: "line-types",     title: "Line Types: Goblin & Demon" },
  { id: "true-edge",      title: "Edge Score & True Edge" },
  { id: "hit-prob",       title: "Hit Probability" },
  { id: "market-lines",   title: "Market Lines" },
  { id: "entry-builder",  title: "Entry Builder" },
  { id: "power-vs-flex",  title: "Power vs. Flex" },
  { id: "ev",             title: "Expected Value (EV)" },
  { id: "kelly",          title: "Kelly Criterion" },
  { id: "ai-analyst",     title: "AI Analyst" },
  { id: "injuries",       title: "Injuries & News" },
  { id: "review",         title: "Performance Review" },
  { id: "clv-guide",      title: "CLV — The Professional Standard" },
  { id: "bankroll",       title: "Bankroll Management" },
  { id: "mistakes",       title: "Common Mistakes" },
  { id: "glossary",       title: "Glossary" },
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
  const contentRef = useRef<HTMLDivElement>(null);

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
      <nav className="w-52 shrink-0 border-r border-slate-800 overflow-y-auto py-4">
        <div className="flex items-center gap-2 px-4 mb-4">
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">User Guide</span>
        </div>
        <ul className="space-y-0.5">
          {SECTIONS.map(s => (
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

        <Section id="what-is" title="1. What Is VibeMeGood?">
          <p>VibeMeGood is your personal analytics workstation for PrizePicks. Think of it like the Carfax report for PrizePicks — it shows you what the props are actually worth, compares them to what other betting sites are offering, calculates your real chances of winning, and tells you mathematically whether a play is worth making.</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Pulls all of today's live PrizePicks props automatically</li>
            <li>Compares each prop against DraftKings, FanDuel, and ESPN Bet to find hidden value</li>
            <li>Calculates the real probability of each pick hitting</li>
            <li>Finds the best combinations of picks using math</li>
            <li>Gives you an AI analyst you can talk to like a text message</li>
            <li>Tracks your results so you improve over time</li>
          </ul>
        </Section>

        <Section id="prizepicks" title="2. What Is PrizePicks?">
          <p>PrizePicks is a platform where you predict whether a player will score more or less than a set number in a stat category. You combine multiple picks into an entry. The more picks you add, the bigger the potential payout — but also the harder it is to win.</p>
          <Callout color="primary">
            Example: LeBron James — Points — Line: 24.5. Pick MORE (Over). If LeBron scores 25+, you win that pick.
          </Callout>
          <p><span className="text-foreground font-semibold">Power Play</span> — Every single pick must hit. Miss one and you lose everything. Higher payouts.<br /><span className="text-foreground font-semibold">Flex Play</span> — You can miss one or two picks and still get a partial payout. Lower max payout, but safer.</p>
        </Section>

        <Section id="golden-rules" title="3. The Golden Rules">
          <div className="space-y-4">
            <Rule n={1} title="Only play with money you can afford to lose completely.">PrizePicks is gambling. There is no guaranteed win. The app gives you an edge — a better chance — but no certainty. Never bet rent money, grocery money, or money earmarked for anything important.</Rule>
            <Rule n={2} title="Treat it like a business, not a thrill.">The players who make consistent money approach this calmly and methodically. They don't chase losses. They don't double up after a bad day. They follow the math.</Rule>
            <Rule n={3} title="Small stakes, steady habits beat big swings.">A player betting $10/day with smart picks will outperform a player betting $100 randomly. Consistency compounds.</Rule>
            <Rule n={4} title="The app helps you find edges, not guarantees.">Even a 65% probability means you lose 35% of the time. That's 1 in 3 picks. Don't panic when you're right but lose.</Rule>
            <Rule n={5} title="Set a daily loss limit before you play.">In Settings, you can set this. If you hit it, you stop. No exceptions.</Rule>
          </div>
        </Section>

        <Section id="line-types" title="6. Understanding Line Types: Standard, Goblin, and Demon">
          <p><span className="text-foreground font-semibold">Standard Lines</span> — Normal lines set close to what PrizePicks thinks the player will actually do. Roughly 50/50 whether you win.</p>
          <Callout color="emerald">
            <strong>Goblin Lines</strong> — Set lower than normal. PrizePicks is giving you a discount. Hit rate: ~65% on the OVER. Your best friends for Power Plays. The multiplier is slightly lower, but the math still works in your favour.
          </Callout>
          <Callout color="red">
            <strong>Demon Lines</strong> — Set higher than normal. NEVER play Demon OVER — 35% hit rate. You will lose more than you win. BUT: Demon UNDER has ~65% hit rate. If the line is inflated, the UNDER has value.
          </Callout>
        </Section>

        <Section id="true-edge" title="7. Edge Score & True Edge">
          <p><span className="text-foreground font-semibold">True Edge %</span> is the most important number in the app. It tells you how much better or worse PP's line is compared to DraftKings, FanDuel, and ESPN Bet.</p>
          <p className="font-mono bg-slate-800 rounded px-3 py-2 text-foreground">True Edge = (Market Line − PP Line) / Market Line × 100</p>
          <div className="space-y-1">
            <p><span className="text-emerald-400 font-semibold">Positive (green)</span> — PP's line is lower than the market → OVER has value</p>
            <p><span className="text-red-400 font-semibold">Negative (red)</span> — PP's line is higher than the market → Skip or consider UNDER</p>
            <p><span className="text-slate-400 font-semibold">Zero</span> — PP and the market agree → No edge either way</p>
          </div>
        </Section>

        <Section id="hit-prob" title="8. Hit Probability">
          <p>Every pick shows a Hit Probability percentage — the calculated chance the pick goes OVER (or UNDER). For a 4-pick Power Play: P(win) = Pick1% × Pick2% × Pick3% × Pick4%.</p>
          <div className="font-mono bg-slate-800 rounded px-3 py-2 space-y-0.5 text-foreground">
            <div>4 Goblin picks (65% each): 0.65⁴ = <span className="text-primary">17.9%</span></div>
            <div>Mixed picks (58%, 65%, 52%, 58%): <span className="text-amber-300">11.4%</span></div>
          </div>
          <p>This is why pick quality matters so much. Every weak pick dramatically lowers your overall win probability.</p>
        </Section>

        <Section id="market-lines" title="9. Market Lines">
          <p>The Market Lines panel shows how PrizePicks compares to DraftKings, FanDuel, and ESPN Bet. These books have enormous resources and set very accurate lines. When their lines differ from PP, that gap is your opportunity.</p>
          <Callout color="primary">Think of it like comparing prices on Amazon vs. Best Buy. If Best Buy sells a TV for $800 but Amazon has it for $600, you buy from Amazon. When PrizePicks "sells" you a player at a lower line than other books, that's your edge.</Callout>
        </Section>

        <Section id="entry-builder" title="11. The Entry Builder">
          <p>The Entry Builder is where you finalize your picks before playing. It shows: your active picks, the hit probability for each direction, the market edge, and the full payout calculator.</p>
          <p>The <span className="text-foreground font-semibold">EV Panel</span> shows Win Probability, Expected Value, ROI, Probability Chain, and Kelly Recommendation. The <span className="text-foreground font-semibold">Correlation Warning</span> appears if you pick two players from the same NBA or WNBA team — teammates share the same stat pool.</p>
        </Section>

        <Section id="power-vs-flex" title="12. Power vs. Flex Plays">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-foreground font-semibold mb-2">Power Multipliers</div>
              {[["2 picks","3×"],["3 picks","6×"],["4 picks","10×"],["5 picks","20×"],["6 picks","40×"]].map(([p,m]) => (
                <div key={p} className="flex justify-between py-0.5 border-b border-slate-800/40">
                  <span>{p}</span><span className="text-primary font-semibold">{m}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-foreground font-semibold mb-2">5-pick Flex</div>
              {[["5/5","20×"],["4/5","4×"],["3/5","1× (break-even)"],["≤2/5","Lose"]].map(([k,v]) => (
                <div key={k} className="flex justify-between py-0.5 border-b border-slate-800/40">
                  <span>{k}</span><span className="text-primary font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <Callout color="amber">Quick rule: If your win probability is under 10%, go Flex. If it's over 15%, Power is better mathematically.</Callout>
        </Section>

        <Section id="ev" title="13. Expected Value (EV)">
          <p>EV tells you how much you'll profit (or lose) on average if you made the same bet hundreds of times. <span className="text-emerald-400 font-semibold">Positive EV</span> = you'll profit over time. <span className="text-red-400 font-semibold">Negative EV</span> = you'll lose over time.</p>
          <div className="font-mono bg-slate-800 rounded px-3 py-2 text-foreground">
            EV = (P(win) × Payout) − (P(lose) × Stake)<br />
            4-pick Goblin Power, $25: (0.179 × $250) − (0.821 × $25) = <span className="text-emerald-400">+$24.22</span>
          </div>
          <p>This is why Goblin lines are so powerful. The higher hit rate tips the math in your favour. Standard 4-pick at 50% each: EV = <span className="text-red-400">−$7.81</span>. This is why most PrizePicks players lose.</p>
        </Section>

        <Section id="kelly" title="14. Kelly Criterion">
          <p>The Kelly Criterion is a mathematical formula that calculates the optimal bet size based on your edge and payout odds. The app calculates this for you automatically.</p>
          <p>The app defaults to <span className="text-foreground font-semibold">Quarter Kelly (0.25)</span> — meaning we recommend betting 25% of what pure Kelly suggests. Pure Kelly assumes you know exact probabilities, which you don't — they're estimates. Quarter Kelly is the professional standard.</p>
        </Section>

        <Section id="ai-analyst" title="15. The AI Analyst">
          <p>The AI Analyst is powered by Claude. Think of it as having a sports analytics expert on speed dial — with live access to today's slate, your watchlist, injuries, and recent P&L.</p>
          <p>What you can ask:</p>
          <ul className="space-y-0.5 list-disc list-inside">
            <li>"Is Anthony Davis's points line good value today?"</li>
            <li>"What's the best 4-pick power play today?"</li>
            <li>"My picks are [X, Y, Z] — are they correlated?"</li>
            <li>"Analyze my current entry"</li>
            <li>"What's the weakest pick in my lineup?"</li>
          </ul>
        </Section>

        <Section id="injuries" title="16. Injuries & News">
          <p>Check the Injuries page within 30 minutes of game time for any player you're picking.</p>
          <div className="space-y-1">
            <Callout color="red"><strong>OUT</strong> — Do not play any prop for this player. Period.</Callout>
            <Callout color="amber"><strong>GTD</strong> — Game-Time Decision. Wait until confirmed before playing. If lineup confirmation hasn't posted, skip.</Callout>
            <Callout color="emerald"><strong>ACTIVE</strong> — Cleared to play.</Callout>
          </div>
          <p>Quick rule: If a player is GTD and you haven't seen lineup confirmation, do NOT include them in a Power Play. Put them in Flex at most.</p>
        </Section>

        <Section id="review" title="17. Performance Review">
          <p>The Performance Review page tracks every entry you've logged. Key metrics:</p>
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
          <p>CLV measures whether the lines moved in your favour after you locked in your pick. If you pick Davis OVER 26.5 and the line later moves to 27.5, your CLV is +1.0. You got a better price than the final market.</p>
          <Callout color="primary">Consistent positive CLV means your process is good, even during losing stretches. It's the most reliable proof that your edge is real, not just luck.</Callout>
          <p>View your CLV history and trend chart on the CLV Tracker page. CLV is recorded automatically when you grade picks in the Journal.</p>
        </Section>

        <Section id="bankroll" title="19. Bankroll Management 101">
          <div className="space-y-2">
            <Rule n={1} title="Never risk more than 5% on any single entry.">If you have $500, max entry is $25. If you have $100, max is $5.</Rule>
            <Rule n={2} title="Set a daily loss limit before you play.">Decide: "If I lose $X today, I stop." Stick to it. Tilt is the #1 killer of bankrolls.</Rule>
            <Rule n={3} title="Don't increase stakes after wins.">Let the bankroll grow slowly. Doubling your stakes after a win usually gives it all back.</Rule>
            <Rule n={4} title="Keep records of everything.">The app does this for you — but you have to log your entries. Without data, you're flying blind.</Rule>
            <Rule n={5} title="Give yourself at least 200 entries before judging.">Variance is brutal in the short term. A player with a real edge can have a terrible 30-entry stretch.</Rule>
          </div>
        </Section>

        <Section id="mistakes" title="20. Common Mistakes">
          <div className="space-y-2">
            {[
              ["Playing Demon OVER lines", "35% hit rate. You lose 65% of the time. Filter the Slate Board to hide Demons."],
              ["Stacking NBA teammates", "They share the same stat pool. The app warns you automatically. Heed the warning."],
              ["Ignoring injuries in a Power Play", "If they scratch, you lose everything. Check Injuries 30 minutes before tip-off."],
              ["Playing on gut feeling", "Your gut doesn't know what DraftKings is pricing the line at. Always check True Edge first."],
              ["Chasing losses by increasing stake", "Set a daily loss limit in Settings. When you hit it, close the app."],
              ["Too many picks in a Power Play", "A 6-pick Power at 60% each is only 4.7%. Stick to 3–4 picks."],
              ["Ignoring line movement", "If the line moved against you, sharp money may disagree. Check the line move column."],
            ].map(([t, d]) => (
              <div key={t} className="bg-slate-900 border border-slate-800 rounded p-3">
                <div className="text-red-400 font-semibold text-xs mb-0.5">✕ {t}</div>
                <div className="text-slate-400 text-xs">{d}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="glossary" title="21. Glossary">
          <div className="space-y-2">
            {[
              ["Bankroll", "Total money set aside for PrizePicks. Never your total savings."],
              ["CLV", "Closing Line Value. How much the line moved between when you picked and game time. Positive = you got a better price."],
              ["Demon Line", "A PP line set higher than market consensus. OVER is a trap; UNDER has value."],
              ["Edge", "Your mathematical advantage over PrizePicks. Positive = expect to profit."],
              ["Entry", "Your full lineup of picks submitted to PrizePicks."],
              ["EV", "Expected Value. How much you'll win or lose on average per bet if repeated many times."],
              ["Flex Play", "Entry type where you can miss one or two picks and still get a partial payout."],
              ["Goblin Line", "A PP line set lower than market consensus. OVER has value, hits ~65%."],
              ["Hit Rate", "How often a specific type of pick wins. Goblin ≈ 65%, Standard ≈ 52%, Demon OVER ≈ 35%."],
              ["Kelly Criterion", "Formula that calculates optimal bet size based on your edge and payout odds."],
              ["Line Movement", "When the line changes between posting and game time. Sharp money moves lines."],
              ["Market Line", "Average line across DraftKings, FanDuel, and ESPN Bet."],
              ["Power Play", "Entry type where every single pick must hit to win. Higher payouts."],
              ["Sharp", "A sophisticated, mathematically-driven bettor who focuses on edge."],
              ["Stack", "Picking two or more players from the same team. Risky in basketball."],
              ["True Edge", "Percentage difference between PP's line and market average. Positive = OVER value."],
              ["Unit", "Your standard bet size, usually 3–5% of your bankroll."],
              ["Variance", "Natural randomness in outcomes. Even 70% probability loses 30% of the time."],
            ].map(([term, def]) => (
              <div key={term} className="flex gap-3">
                <span className="font-semibold text-primary shrink-0 w-28">{term}</span>
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
              <QR situation="Teammates stacked (NBA)" action="Warning — avoid if possible" />
              <QR situation="Line moved against you" action="Be cautious — sharp money disagrees" />
              <QR situation="EV is positive" action="Mathematically sound play" />
              <QR situation="EV is negative" action="Bad play long-term, even if it feels right" />
            </tbody>
          </table>
        </Section>

      </div>
    </div>
  );
}
