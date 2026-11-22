// Token Radar v2 — Launch Radar: every value term fitted and tested held-out
// twice, token odds from the peers' record, integrity strip, costed farm
// verdicts. Entry for make.fun token-radar-01.
//
// Reads the sealed snapshot (/input/snapshot.json) and the fitted model
// (fit.json, shipped in this repo: value-model coefficients, token-odds
// coefficients, 200 bootstrap refits, validation numbers), ranks the
// pre-token protocols by implied value, and writes the board, the
// dashboard's data, and the dossier to /output.
//
// Run locally:  mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out \
//                 node main.ts --input <kit>/input/snapshot.json
// In the grader: node /bot/main.ts with MAKEFUN_BOT_DIR=/bot,
// MAKEFUN_OUTPUT_DIR=/output, snapshot at /input/snapshot.json.
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { buildDossier } from "./vendor/makefun-board.ts";

const BOT_DIR = process.env.MAKEFUN_BOT_DIR || ".";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "out";

function snapshotPath(): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith("--input=")) return argv[i].slice("--input=".length);
  }
  const cands = [
    "/input/snapshot.json",
    path.join(BOT_DIR, "..", "input", "snapshot.json"),
    path.join(BOT_DIR, "input", "snapshot.json"),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return "/input/snapshot.json";
}

// ---------- small helpers ----------
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function sigmoid(z: number): number {
  const c = clamp(z, -30, 30);
  return 1 / (1 + Math.exp(-c));
}
function fmtMoney(n: number): string {
  const v = Math.round(n);
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return "$" + v.toLocaleString("en-US");
  return "$" + v;
}
function fmtMoney1(n: number): string {
  // one decimal, for per-hour figures
  return "$" + n.toFixed(1);
}

// ---------- the fitted model (fit.json) ----------
interface FitJson {
  value_model: { intercept: number; slope: number; centre: number; n_fit: number;
    boot_se_intercept: number; boot_se_slope: number; slope_ci95: [number, number] };
  odds_model: { coef: number[]; base_rate: number; base_brier: number; cv_brier: number };
  validation: Record<string, unknown>;
  ledger: { board: number; listed: number; excluded: number; total: number;
    watchlist: number; parent20: number };
  farm_assumptions: { gas_week: number; weeks: number; fee_apr: number;
    tbill_apr: number; drop_share: number; farmed_frac: number; hours_week: number;
    farm_net_min: number; farm_neth_min: number; skip_neth_max: number };
  boot_betas: [number, number][];
}

interface Proto {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}

const EXCL_CATS = new Set(["Bridge", "Canonical Bridge", "Liquid Staking",
  "Liquid Restaking", "Restaked BTC", "CEX"]);

function hasToken(p: Proto): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}
function exclReason(p: Proto): string | null {
  if (p.category !== null && EXCL_CATS.has(p.category)) return "cat:" + p.category;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return "name-word";
  if (/\s+(V2|v2|2\.0|V3|v3|3\.0)\s*$/.test(p.name)) return "version";
  if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/.test(p.name)) return "exchange";
  return null;
}
function familyOf(name: string): string {
  return name.replace(/\s+(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)\s*$/, "");
}
function ageDays(p: Proto, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const [y, m, d] = p.listed_at.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  return Math.round((asOf.getTime() - t) / 86400000);
}
function growth(p: Proto): number {
  return p.change_7d === null || p.change_7d === undefined ? 0 : p.change_7d;
}

// ---------- farm plan template ----------
// One function, shared word-for-word with dashboard/app.js, so the detail
// view renders exactly the steps board.json carries. Keep both in sync.
const CAT_ACTION: Record<string, string> = {
  "Risk Curators": "allocate capital through its curator vaults",
  "Dexs": "provide liquidity",
  "Onchain Capital Allocator": "allocate capital through its vaults",
  "RWA": "deposit into its real-world-asset vault",
  "Lending": "lend it out",
  "Yield": "deposit into its yield vault",
  "Derivatives": "open a hedged position",
  "CDP": "mint against the deposit",
  "Yield Aggregator": "deposit into its aggregator vault",
  "Basis Trading": "deposit into its basis-trading vault",
  "Chain": "use its chain",
  "Staking Pool": "stake it",
  "Liquidity Manager": "deposit into its managed liquidity position",
  "Prediction Market": "provide liquidity to its markets",
  "Restaking": "restake it",
};
function catAction(cat: string | null): string {
  if (cat !== null && CAT_ACTION[cat]) return CAT_ACTION[cat];
  return "use the protocol";
}

interface FarmNums { deposit: number; drop: number; fees: number; gas: number;
  opp: number; net: number; netHour: number; hours: number; verdict: string }
interface Peer { slug: string; name: string; mcap: number; tvl: number; mult: number }
interface RowData {
  slug: string; name: string; category: string | null; chains: string[];
  tvl: number; chg7d: number | null; ageDays: number | null;
  watchlist: boolean; parentFlag: boolean;
  ifListing: number; odds: number; implied: number; p25: number; p75: number;
  farm: FarmNums; peers: Peer[];
}

function farmSteps(r: RowData): string[] {
  const f = r.farm;
  const chain0 = r.chains[0] || "Ethereum";
  const p1 = r.peers[0];
  const p2 = r.peers[1];
  return [
    "Bridge " + fmtMoney(f.deposit) + " to " + chain0 + " for " + r.name +
      " and confirm it lands before doing anything else. Gas is about $12 and it takes around 10 minutes.",
    "Deposit " + fmtMoney(f.deposit) + " into " + r.name + " to " + catAction(r.category) +
      " on " + chain0 + ". Keep the receipt and the position ID.",
    "Leave the deposit working for the full 12-week horizon and check the position once a week, about 15 minutes a week.",
    "Claim or compound any rewards weekly instead of letting them sit idle. Gas is about $12 per claim.",
    "Watch " + r.name + "'s TVL and any token announcement. Exit early if TVL falls 30% or more in a single week.",
    "At week 12, or the day a token is announced, withdraw the deposit back to " + chain0 + ". Gas is about $12.",
    "If a token lists, claim the airdrop inside its claim window. An unclaimed drop is lost, so set a reminder now.",
    "Sell half the claimed tokens at listing and hold the rest for 30 days. That is the exit rule for this farm.",
    "Net after fees: drop " + fmtMoney(f.drop) + " + fees " + fmtMoney(f.fees) +
      " - gas " + fmtMoney(f.gas) + " - opportunity cost " + fmtMoney(f.opp) +
      " = " + fmtMoney(f.net) + " over 12 weeks (" + fmtMoney1(f.netHour) + "/hour).",
    "Nearest priced peers: " + p1.name + " (cap " + fmtMoney(p1.mcap) + ", " + p1.mult +
      "x TVL) and " + p2.name + " (cap " + fmtMoney(p2.mcap) + ", " + p2.mult +
      "x TVL). The value model prices " + r.name + " against these two.",
  ];
}

// ---------- main ----------
function main(): void {
  const snapRaw = JSON.parse(fs.readFileSync(snapshotPath(), "utf8"));
  const fit: FitJson = JSON.parse(fs.readFileSync(path.join(BOT_DIR, "fit.json"), "utf8"));
  const prots: Proto[] = snapRaw.protocols;
  const watchlist: string[] = snapRaw.watchlist;
  const wlSet = new Set(watchlist);
  const asOf = new Date(snapRaw.as_of + "T00:00:00Z");
  const fa = fit.farm_assumptions;
  const vm = fit.value_model;
  const oc = fit.odds_model.coef;

  // family sizes, counted over the whole snapshot (a feature, not a label)
  const famCount = new Map<string, number>();
  for (const p of prots) {
    const f = familyOf(p.name);
    famCount.set(f, (famCount.get(f) || 0) + 1);
  }

  // the 20 protocols the house watchlist excludes via parentProtocol, a
  // field the snapshot does not carry: identified here as pre-token,
  // TVL >= $50M, not on the watchlist, passing every visible rule.
  const parent20 = new Set<string>();
  for (const p of prots) {
    if (!hasToken(p) && p.tvl_usd >= 50000000 && !wlSet.has(p.slug) && exclReason(p) === null) {
      parent20.add(p.slug);
    }
  }

  // listed comps, for nearest priced peers
  const comps = prots.filter((p) => hasToken(p) && p.mcap_usd && p.mcap_usd > 0 && p.tvl_usd > 0);

  function oddsOf(p: Proto): number {
    const a = ageDays(p, asOf);
    const la = Math.log(a === null ? 30 : Math.max(a, 30));
    const feats = [1, la - 6, Math.log(p.tvl_usd) - 17,
      clamp(growth(p), -50, 50) / 10, famCount.get(familyOf(p.name)) || 1];
    let z = 0;
    for (let i = 0; i < oc.length; i++) z += oc[i] * feats[i];
    return sigmoid(z);
  }
  function ifListingOf(p: Proto): number {
    const lr = vm.intercept + vm.slope * (Math.log(p.tvl_usd) - vm.centre);
    return p.tvl_usd * Math.exp(lr);
  }
  function farmNums(p: Proto, ifVal: number, odds: number): FarmNums {
    const D = Math.max(10000, 0.0002 * p.tvl_usd);
    const drop = fa.drop_share * ifVal * odds * (D / (fa.farmed_frac * p.tvl_usd));
    const fees = D * fa.fee_apr * fa.weeks / 52;
    const gas = fa.gas_week * fa.weeks;
    const opp = D * fa.tbill_apr * fa.weeks / 52;
    const net = drop + fees - gas - opp;
    const hours = fa.hours_week * fa.weeks;
    const netHour = net / hours;
    let verdict = "MARGINAL";
    if (net >= fa.farm_net_min && netHour >= fa.farm_neth_min) verdict = "FARM";
    else if (net <= 0 || netHour < fa.skip_neth_max) verdict = "SKIP";
    return { deposit: Math.round(D), drop: Math.round(drop), fees: Math.round(fees),
      gas: Math.round(gas), opp: Math.round(opp), net: Math.round(net),
      netHour: Math.round(netHour * 10) / 10, hours, verdict };
  }
  function nearestPeers(p: Proto, k: number): Peer[] {
    const dist = (q: Proto) => Math.abs(Math.log(q.tvl_usd) - Math.log(p.tvl_usd));
    const same = comps.filter((q) => q.category === p.category).sort((a, b) => dist(a) - dist(b));
    const out: Proto[] = same.slice(0, k);
    if (out.length < k) {
      const rest = comps.filter((q) => !out.includes(q)).sort((a, b) => dist(a) - dist(b));
      out.push(...rest.slice(0, k - out.length));
    }
    return out.map((q) => ({ slug: q.slug, name: q.name, mcap: q.mcap_usd as number,
      tvl: q.tvl_usd, mult: Math.round((q.mcap_usd as number) / q.tvl_usd * 1000) / 1000 }));
  }

  // ---------- the board ----------
  const boardProts = prots.filter((p) => !hasToken(p) && p.tvl_usd >= 5000000 && exclReason(p) === null);
  const rows: RowData[] = [];
  for (const p of boardProts) {
    const ifVal = ifListingOf(p);
    const odds = oddsOf(p);
    const implied = ifVal * odds;
    // P25-P75 of implied value over the 200 bootstrap refits of the value model
    const vals: number[] = [];
    for (const bb of fit.boot_betas) {
      const lr = bb[0] + bb[1] * (Math.log(p.tvl_usd) - vm.centre);
      vals.push(p.tvl_usd * Math.exp(lr) * odds);
    }
    vals.sort((a, b) => a - b);
    const p25 = vals[Math.floor(0.25 * vals.length)];
    const p75 = vals[Math.floor(0.75 * vals.length)];
    rows.push({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl: p.tvl_usd, chg7d: p.change_7d, ageDays: ageDays(p, asOf),
      watchlist: wlSet.has(p.slug), parentFlag: parent20.has(p.slug),
      ifListing: Math.round(ifVal), odds,
      implied: Math.round(implied), p25: Math.round(p25), p75: Math.round(p75),
      farm: farmNums(p, ifVal, odds), peers: nearestPeers(p, 2),
    });
  }
  // rank by implied value, ties broken by TVL then slug (deterministic)
  rows.sort((a, b) => (b.implied - a.implied) || (b.tvl - a.tvl) || (a.slug < b.slug ? -1 : 1));

  // ---------- outputs ----------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dashOut = path.join(OUT_DIR, "dashboard");
  const shotOut = path.join(OUT_DIR, "screenshots");
  fs.mkdirSync(dashOut, { recursive: true });
  fs.mkdirSync(shotOut, { recursive: true });

  const boardRows = rows.map((r, i) => ({
    slug: r.slug, name: r.name, rank: i + 1,
    implied_value_usd: r.implied,
    farm_steps: farmSteps(r),
    category: r.category, tvl_usd: r.tvl, change_7d: r.chg7d,
    age_days: r.ageDays, watchlist: r.watchlist,
    if_listing_value_usd: r.ifListing, token_odds: Math.round(r.odds * 1000) / 1000,
    implied_p25_usd: r.p25, implied_p75_usd: r.p75,
    farm_verdict: r.farm.verdict, farm_net_usd: r.farm.net,
    farm_net_per_hour_usd: r.farm.netHour, farm_deposit_usd: r.farm.deposit,
    nearest_peers: r.peers,
  }));
  fs.writeFileSync(path.join(OUT_DIR, "board.json"), JSON.stringify({ rows: boardRows }, null, 1));

  // dashboard data: compact rows + the comps table + the evidence.
  // The page recomputes implied values, farm numbers and verdicts from
  // these inputs and checks them against board.json (integrity strip).
  const selfSha = crypto.createHash("sha256")
    .update(fs.readFileSync(new URL(import.meta.url))).digest("hex");
  const data = {
    asOf: snapRaw.as_of,
    model: {
      intercept: vm.intercept, slope: vm.slope, centre: vm.centre, nFit: vm.n_fit,
      bootSeSlope: vm.boot_se_slope, slopeCi95: vm.slope_ci95,
      oddsCoef: oc, oddsBaseRate: fit.odds_model.base_rate,
      oddsBaseBrier: fit.odds_model.base_brier, oddsCvBrier: fit.odds_model.cv_brier,
    },
    validation: fit.validation,
    ledger: fit.ledger,
    farm: fa,
    mainSha: selfSha.slice(0, 8),
    rows: rows.map((r) => [
      r.slug, r.name, r.category, r.tvl, r.chg7d, r.ageDays, r.odds,
      r.p25, r.p75, r.watchlist ? 1 : 0, r.parentFlag ? 1 : 0, r.chains[0] || "",
    ]),
    comps: comps.map((q) => [q.slug, q.name, q.category, q.tvl_usd, q.mcap_usd as number]),
  };
  fs.writeFileSync(path.join(dashOut, "data.js"),
    "window.RADAR = " + JSON.stringify(data) + ";\n");

  // copy the dashboard and the screenshots into /output
  for (const f of fs.readdirSync(path.join(BOT_DIR, "dashboard"))) {
    fs.copyFileSync(path.join(BOT_DIR, "dashboard", f), path.join(dashOut, f));
  }
  for (const f of fs.readdirSync(path.join(BOT_DIR, "screenshots"))) {
    fs.copyFileSync(path.join(BOT_DIR, "screenshots", f), path.join(shotOut, f));
  }

  // dossier, byte for byte what the kit library writes
  const bytes = buildDossier(OUT_DIR, { text_max_bytes: 65536 });
  fs.writeFileSync(path.join(OUT_DIR, "dossier.json"), bytes);
  const verdicts: Record<string, number> = {};
  for (const r of rows) verdicts[r.farm.verdict] = (verdicts[r.farm.verdict] || 0) + 1;
  console.log("board: " + rows.length + " rows, verdicts " + JSON.stringify(verdicts) +
    ", top implied " + fmtMoney(rows[0].implied) + " (" + rows[0].slug + ")");
  console.log("wrote " + path.join(OUT_DIR, "board.json") + ", dashboard/data.js, dossier.json");
}

main();
