import { inspect } from "util";

const API_KEY = process.env.SGO_API_KEY;
if (!API_KEY) throw new Error("SGO_API_KEY not set");

const BASE = "https://api.sportsgameodds.com/v2";

async function get(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("apiKey", API_KEY!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  return res.json();
}

async function main() {
  // ── 1. Which leagues have live props right now? ──────────────────────────
  console.log("\n========== 1. ACTIVE LEAGUES ==========");
  const leagues = ["NBA", "NFL", "MLB", "NHL", "WNBA", "MLS", "CBB", "CFB", "NCAAB", "NCAAF"];
  const active: string[] = [];
  for (const l of leagues) {
    const d = await get("/events", { leagueID: l, type: "prop", oddsAvailable: "true", limit: "1" });
    const count = ((d.data ?? d.items ?? []) as unknown[]).length;
    console.log(`  ${l}: ${count > 0 ? "✅ " + count + " events" : "❌ none"}`);
    if (count > 0) active.push(l);
  }

  if (active.length === 0) {
    console.log("\nNo active prop leagues found. Trying without oddsAvailable filter...");
    for (const l of leagues) {
      const d = await get("/events", { leagueID: l, limit: "1" });
      const count = ((d.data ?? d.items ?? []) as unknown[]).length;
      if (count > 0) console.log(`  ${l}: ${count} events (any type)`);
    }
    return;
  }

  const league = active[0];
  console.log(`\nUsing ${league} for remaining tests.`);

  // ── 2. Raw event structure ───────────────────────────────────────────────
  console.log("\n========== 2. RAW EVENT STRUCTURE ==========");
  const sample = await get("/events", {
    leagueID: league,
    type: "prop",
    oddsAvailable: "true",
    limit: "2",
  });
  const items = (sample.data ?? sample.items ?? []) as any[];
  if (items[0]) {
    console.log("Keys:", Object.keys(items[0]));
    console.log(inspect(items[0], { depth: 5, colors: false }).slice(0, 3000));
  }

  // ── 3. All markets on PrizePicks ─────────────────────────────────────────
  console.log("\n========== 3. PRIZEPICKS MARKETS ==========");
  const ppAll = await get("/events", {
    leagueID: league,
    type: "prop",
    oddsAvailable: "true",
    bookmakerID: "prizepicks",
    limit: "200",
  });
  const ppItems = (ppAll.data ?? ppAll.items ?? []) as any[];
  console.log(`PP events returned: ${ppItems.length}`);

  const markets = new Map<string, number>();
  for (const p of ppItems) {
    const m = String(p.marketName ?? p.statType ?? p.market ?? p.statID ?? "unknown");
    markets.set(m, (markets.get(m) ?? 0) + 1);
  }
  console.log(`Unique PP markets (${markets.size}):`);
  for (const [m, n] of [...markets.entries()].sort()) {
    console.log(`  ${m.padEnd(40)} (${n} props)`);
  }

  // ── 4. Combo / PRA check ─────────────────────────────────────────────────
  console.log("\n========== 4. COMBO / PRA CHECK ==========");
  const comboKw = ["pra", "combo", "fantasy", "pts+", "reb+", "ast+", "points+rebounds", "points+assists", "pr+a", "+reb", "+ast", "multi"];
  const combos = [...markets.keys()].filter(m => comboKw.some(k => m.toLowerCase().includes(k)));
  if (combos.length) {
    console.log("✅ Combo/PRA markets found:", combos);
  } else {
    console.log("❌ No combo/PRA markets visible (may need game-day slate or different league)");
  }

  // ── 5. Multi-book comparison on one player ───────────────────────────────
  console.log("\n========== 5. MULTI-BOOK LINE COMPARISON ==========");
  const propWithBooks = ppItems.find((p: any) => {
    const by = p.byBookmaker ?? p.odds ?? p.bookmakers ?? {};
    return Object.keys(by).length >= 2;
  }) ?? ppItems[0];

  if (propWithBooks) {
    const name = propWithBooks.playerName ?? propWithBooks.name ?? propWithBooks.playerID ?? "?";
    const market = propWithBooks.marketName ?? propWithBooks.statType ?? "?";
    console.log(`Player: ${name}  |  Market: ${market}`);
    const by = propWithBooks.byBookmaker ?? propWithBooks.odds ?? propWithBooks.bookmakers ?? {};
    const bookList = ["prizepicks", "draftkings", "fanduel", "pinnacle", "betmgm", "caesars"];
    for (const b of bookList) {
      const line = by[b];
      if (line) console.log(`  ${b.padEnd(15)} ${inspect(line, { depth: 2, breakLength: 120 })}`);
      else console.log(`  ${b.padEnd(15)} —`);
    }
    // Also print whatever books ARE present
    const presentBooks = Object.keys(by).filter(b => !bookList.includes(b));
    if (presentBooks.length) console.log("  Other books present:", presentBooks);
  } else {
    console.log("No multi-book props found.");
  }

  // ── 6. Timestamp / line-movement fields ──────────────────────────────────
  console.log("\n========== 6. TIMESTAMP FIELDS ==========");
  const anyProp = ppItems[0] ?? items[0];
  if (anyProp) {
    const allKeys = Object.keys(anyProp);
    const tsKeys = allKeys.filter(k =>
      ["time", "date", "updated", "created", "captured", "at", "stamp", "posted", "open", "close"].some(w =>
        k.toLowerCase().includes(w)
      )
    );
    console.log("Time-related keys:", tsKeys);
    for (const k of tsKeys) console.log(`  ${k}: ${anyProp[k]}`);
    // Check inside byBookmaker for timestamps
    const by = anyProp.byBookmaker ?? anyProp.odds ?? {};
    const firstBook = Object.values(by)[0] as any;
    if (firstBook && typeof firstBook === "object") {
      const bkTsKeys = Object.keys(firstBook).filter(k =>
        ["time", "date", "updated", "created", "captured", "at", "stamp", "open"].some(w => k.toLowerCase().includes(w))
      );
      console.log("Time-related keys inside byBookmaker entry:", bkTsKeys);
      for (const k of bkTsKeys) console.log(`  byBookmaker.${k}: ${firstBook[k]}`);
    }
  }

  // ── 7. Player name normalization sample ──────────────────────────────────
  console.log("\n========== 7. PLAYER NAME NORMALIZATION ==========");
  const nameSample = ppItems.slice(0, 10).map((p: any) => ({
    raw: p.playerName ?? p.name ?? p.playerID ?? "?",
    id: p.playerID ?? p.entityID ?? "?",
    market: p.marketName ?? "?",
  }));
  for (const n of nameSample) console.log(`  ${n.id.padEnd(30)} "${n.raw}"  (${n.market})`);

  console.log("\n========== DONE ==========");
}

main().catch(console.error);
