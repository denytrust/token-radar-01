// Token Radar v4 — token-radar-01 (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json (or --input <path>) and
// the fitted model in fit.json next to this file, and writes to the output
// directory (MAKEFUN_OUTPUT_DIR, else /output):
//   board.json, dashboard/data.js, dashboard/, screenshots/, dossier.json
// Deterministic: no clock, no randomness, no network. Two runs write
// byte-identical output.
//
// Model (from DOSSIER.md section 7, coefficients shipped in fit.json):
//   Value: ln(mcap / TVL_fam) = intercept + slope * (ln(TVL_fam) - 17),
//          TVL_fam is the family-total TVL when a protocol belongs to a
//          multi-protocol family, else its own TVL. Fit on 113 comps.
//   Odds: logistic on [1, ln TVL - 17, clip(change_7d, +-50)/10, family
//          size, category rate - base rate, post2024 flag], where post2024
//          is 1 when listed_at >= 2024-05-17 (a calendar regime cut, not
//          an age). The dated/age terms of v3 are gone: the regime flag
//          absorbs the age/cohort signal (CV Brier 0.1965 vs v3 0.2045).
//   Implied = if-listing value * odds. P25/P75 come from the 200 bootstrap
//          refits of the value model in fit.json (odds held fixed).
//   Farm math is unchanged from v3: deposit max($10k, 0.02% TVL), drop
//          7% of if-listing value times odds times deposit / 10% TVL,
//          fees 6% APR, gas $12/week, T-bill 4.5% APR, 12 weeks, 2 h/week.
//          FARM needs net >= $2,000 and >= $50/hour; SKIP is net <= $0
//          or under $25/hour; the rest is MARGINAL.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const REGIME_CUT = '2024-05-17';
const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
// House exclusion, exactly as the analysis that produced board_rows.json
// applies it: only the V2/V3 spellings count as a version suffix here
// ("Metric V1", "Privacy Pools V1", "Rysk V12" stay on the board).
const VERSION_SUFFIX = /\s+(V2|v2|2\.0|V3|v3|3\.0)\s*$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const FAMILY_SUFFIX = /\s+(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)\s*$/;

// Python's round() rounds halves to even; Math.round() does not. The
// reference board was produced with Python, so reproduce its rounding.
function pyRound(x, digits = 0) {
  const m = 10 ** digits;
  const y = x * m;
  const f = Math.floor(y);
  const diff = y - f;
  if (diff > 0.5) return (f + 1) / m;
  if (diff < 0.5) return f / m;
  return (f % 2 === 0 ? f : f + 1) / m;
}

function money(n) {
  const s = String(Math.round(n));
  const neg = s.startsWith('-');
  const digits = neg ? s.slice(1) : s;
  return (neg ? '-$' : '$') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) out.input = argv[++i];
  }
  return out;
}

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const botDir = process.env.MAKEFUN_BOT_DIR
    ? resolve(process.env.MAKEFUN_BOT_DIR)
    : dirname(fileURLToPath(import.meta.url));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ? resolve(process.env.MAKEFUN_OUTPUT_DIR) : '/output';
  const inputPath = args.input ?? '/input/snapshot.json';

  const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
  const fit = JSON.parse(readFileSync(join(botDir, 'fit.json'), 'utf8'));
  const protocols = snapshot.protocols;
  const watchlist = new Set(snapshot.watchlist);
  const asOf = new Date(`${snapshot.as_of}T00:00:00Z`).getTime();

  const hasToken = (p) => p.gecko_id !== null || p.symbol !== null;
  const familyName = (name) => name.replace(FAMILY_SUFFIX, '');
  const familySize = new Map();
  const familyTvl = new Map();
  for (const p of protocols) {
    const f = familyName(p.name);
    familySize.set(f, (familySize.get(f) ?? 0) + 1);
    familyTvl.set(f, (familyTvl.get(f) ?? 0) + p.tvl_usd);
  }
  const sizeTvl = (p) => {
    const f = familyName(p.name);
    return (familySize.get(f) ?? 1) > 1 ? familyTvl.get(f) : p.tvl_usd;
  };
  const ageDays = (p) => {
    if (!p.listed_at) return null;
    return Math.round((asOf - new Date(`${p.listed_at}T00:00:00Z`).getTime()) / DAY_MS);
  };
  const post2024 = (p) => (p.listed_at !== null && p.listed_at >= REGIME_CUT ? 1 : 0);
  const growth = (p) => (p.change_7d === null ? 0 : p.change_7d);

  const excludedReason = (p) => {
    if (EXCLUDED_CATEGORIES.has(p.category)) return 'category';
    if (WRAPPED_WORD.test(p.name)) return 'name-word';
    if (VERSION_SUFFIX.test(p.name)) return 'version';
    if (EXCHANGE_PREFIX.test(p.name)) return 'exchange';
    return null;
  };

  // Category listing rates over the whole snapshot (in-fold leakage does
  // not apply here: the shipped coefficients were fit this way, and the
  // board is a prediction, not a validation fold).
  const catTotals = new Map();
  for (const p of protocols) {
    const key = p.category === null ? '\0null' : p.category;
    const cur = catTotals.get(key) ?? { n: 0, listed: 0 };
    cur.n += 1;
    if (hasToken(p)) cur.listed += 1;
    catTotals.set(key, cur);
  }
  const catRates = {};
  for (const [key, cur] of catTotals) catRates[key] = cur.listed / cur.n;
  const listedCount = protocols.filter(hasToken).length;
  const baseRate = listedCount / protocols.length;

  // --- fitted models (coefficients are data from fit.json) ---
  const vm = fit.value_model;
  const om = fit.odds_model;
  const fa = fit.farm_assumptions;
  const valueLogRatio = (tvl) => vm.intercept + vm.slope * (Math.log(tvl) - vm.centre);
  const ifListingValue = (p) => sizeTvl(p) * Math.exp(valueLogRatio(sizeTvl(p)));
  const tokenOdds = (p) => {
    const key = p.category === null ? '\0null' : p.category;
    const catRate = catRates[key] ?? baseRate;
    const feats = [
      1,
      Math.log(p.tvl_usd) - 17,
      Math.max(-50, Math.min(50, growth(p))) / 10,
      familySize.get(familyName(p.name)) ?? 1,
      catRate - baseRate,
      post2024(p),
    ];
    let z = 0;
    for (let i = 0; i < feats.length; i++) z += om.coef[i] * feats[i];
    const zc = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-zc));
  };

  const farmNumbers = (p, ifVal, odds) => {
    const deposit = Math.max(10000, 0.0002 * p.tvl_usd);
    const drop = fa.drop_share * ifVal * odds * (deposit / (fa.farmed_frac * p.tvl_usd));
    const fees = deposit * fa.fee_apr * (fa.weeks / 52);
    const gas = fa.gas_week * fa.weeks;
    const opp = deposit * fa.tbill_apr * (fa.weeks / 52);
    const net = drop + fees - gas - opp;
    const hours = fa.hours_week * fa.weeks;
    const netHour = net / hours;
    let verdict = 'MARGINAL';
    if (net >= fa.farm_net_min && netHour >= fa.farm_neth_min) verdict = 'FARM';
    else if (net <= 0 || netHour < fa.skip_neth_max) verdict = 'SKIP';
    return { deposit, drop, fees, gas, opp, net, hours, netHour, verdict };
  };

  // Ten-step farm plan. Same template as the dashboard's detail view
  // (app.js builds the identical steps from the same numbers).
  function farmSteps(p, r) {
    const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
    const sharePct = ((r.farm.deposit / (0.1 * p.tvl_usd)) * 100).toFixed(2);
    const peerLines = r.peers
      .map((q) => `${q.name} trades at ${q.mult.toFixed(3)}x TVL`)
      .join(' and ');
    const ownMult = (r.ifListing / p.tvl_usd).toFixed(3);
    const halfTvl = money(Math.round(p.tvl_usd / 2));
    const nh = r.farm.net_hour;
    const nhStr = `${nh < 0 ? '-$' : '$'}${Math.abs(nh).toFixed(1)}`;
    return [
      `Move ${money(r.farm.deposit)} of stablecoins onto ${chain} for ${p.name} as your farm stake. This is the working capital for the whole 12-week plan, not a fee.`,
      `Use ${p.name} normally for about 2 hours a week — deposits, swaps or vault actions on ${chain} — so the position reads as a real user, not a one-off wallet.`,
      `Keep the position open for the full 12 weeks (${r.farm.hours} hours in total). Closing early forfeits most of the expected drop value, priced here at ${money(r.farm.drop)}.`,
      `Budget about ${money(r.farm.fees)} in protocol fees over the plan (6% APR on the deposit) and ${money(r.farm.gas)} in gas ($12 a week for 12 weeks). Both are already subtracted from the net below.`,
      `If ${p.name} launches, your expected airdrop share is about ${money(r.farm.drop)}: 7% of the if-listing value (${money(r.ifListing)}) times token odds ${r.odds.toFixed(3)}, times your ${sharePct}% share of farmed TVL.`,
      `Compare that with doing nothing: parking the same ${money(r.farm.deposit)} in T-bills at 4.5% APR would earn ${money(r.farm.opp)} over 12 weeks. The farm has to beat this to be worth it.`,
      `Net of everything, the plan is worth ${money(r.farm.net)} (${nhStr}/hour). Verdict: ${r.farm.verdict} — FARM needs at least $2,000 net and $50/hour; SKIP is net at or below $0 or under $25/hour.`,
      `Exit rule: if ${p.name} launches, sell half the drop in the first week and keep the rest only while TVL holds above ${halfTvl}; if no launch is announced by week 12, withdraw the deposit and move on.`,
      `Sanity-check the value against the nearest priced peers: ${peerLines}, while this board prices ${p.name} at ${ownMult}x TVL if it launches.`,
      `Risk check before you start: the value model misses by x3.26 leave-one-out and the odds are a lower bound for post-2024 protocols. Never deposit more than ${money(r.farm.deposit)} and never borrow to farm.`,
    ];
  }

  // --- board ---
  const boardProts = protocols.filter(
    (p) => !hasToken(p) && p.tvl_usd >= 5000000 && excludedReason(p) === null,
  );
  const listed = protocols.filter(hasToken);
  const excluded = protocols.filter((p) => !hasToken(p) && !boardProts.includes(p));
  const parent20 = new Set(
    protocols
      .filter((p) => !hasToken(p) && p.tvl_usd >= 50000000 && !watchlist.has(p.slug) && excludedReason(p) === null)
      .map((p) => p.slug),
  );

  const comps = listed.filter((p) => p.mcap_usd && p.mcap_usd > 0 && p.tvl_usd && p.tvl_usd > 0);
  const nearestPeers = (p, k = 2) => {
    const dist = (q) => Math.abs(Math.log(q.tvl_usd) - Math.log(p.tvl_usd));
    const same = comps.filter((q) => q.category === p.category).sort((a, b) => dist(a) - dist(b));
    const out = same.slice(0, k);
    if (out.length < k) {
      const rest = comps.filter((q) => !out.includes(q)).sort((a, b) => dist(a) - dist(b));
      out.push(...rest.slice(0, k - out.length));
    }
    return out.map((q) => ({
      slug: q.slug,
      name: q.name,
      mcap: q.mcap_usd,
      tvl: q.tvl_usd,
      mult: pyRound(q.mcap_usd / q.tvl_usd, 3),
    }));
  };

  const boots = fit.boot_betas;
  const rows = [];
  for (const p of boardProts) {
    const ifVal = ifListingValue(p);
    const odds = tokenOdds(p);
    const implied = ifVal * odds;
    const bootImplied = boots
      .map(([bi, bs]) => sizeTvl(p) * Math.exp(bi + bs * (Math.log(sizeTvl(p)) - vm.centre)) * odds)
      .sort((a, b) => a - b);
    const p25 = bootImplied[Math.floor(0.25 * bootImplied.length)];
    const p75 = bootImplied[Math.floor(0.75 * bootImplied.length)];
    const farm = farmNumbers(p, ifVal, odds);
    const peers = nearestPeers(p, 2);
    const r = {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      chg7d: p.change_7d,
      age_days: ageDays(p),
      watchlist: watchlist.has(p.slug),
      parent_flag: parent20.has(p.slug),
      ifListing: pyRound(ifVal),
      odds: pyRound(odds, 3),
      implied: pyRound(implied),
      p25: pyRound(p25),
      p75: pyRound(p75),
      farm: {
        deposit: pyRound(farm.deposit),
        drop: pyRound(farm.drop),
        fees: pyRound(farm.fees),
        gas: pyRound(farm.gas),
        opp: pyRound(farm.opp),
        net: pyRound(farm.net),
        net_hour: pyRound(farm.netHour, 1),
        hours: farm.hours,
        verdict: farm.verdict,
      },
      peers,
    };
    r.farmSteps = farmSteps(p, r);
    rows.push(r);
  }
  rows.sort((a, b) => b.implied - a.implied);
  rows.forEach((r, i) => { r.rank = i + 1; });

  const boardRows = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied,
    farm_steps: r.farmSteps,
    category: r.category,
    tvl_usd: r.tvl,
    change_7d: r.chg7d,
    age_days: r.age_days,
    watchlist: r.watchlist,
    parent_flag: r.parent_flag,
    if_listing_value_usd: r.ifListing,
    token_odds: r.odds,
    implied_p25_usd: r.p25,
    implied_p75_usd: r.p75,
    farm_verdict: r.farm.verdict,
    farm_net_usd: r.farm.net,
    farm_net_per_hour_usd: r.farm.net_hour,
    farm_deposit_usd: r.farm.deposit,
    farm: r.farm,
    nearest_peers: r.peers,
  }));

  // --- dashboard data (compact rows; the page recomputes implied value,
  // farm numbers and verdicts from these and checks them) ---
  // Compact row: [slug, name, category, firstChain, tvl, chg7d, age,
  //   watchlist, ifListing, odds, implied, p25, p75, net, netHour,
  //   verdict, peers[[slug, mult]]]
  // Not shipped, because the page derives them: family size (every board
  // row has fam = 1 — no board protocol belongs to a multi-protocol
  // family, dossier section 7.1), deposit (max($10k, 0.02% TVL)), fees,
  // gas, opportunity cost and drop (same formulas as main.ts), and each
  // peer's market cap (only its multiple is shown).
  const compactRows = rows.map((r) => [
    r.slug,
    r.name,
    r.category,
    r.chains.length > 0 ? r.chains[0] : null,
    r.tvl,
    r.chg7d,
    r.age_days,
    r.watchlist ? 1 : 0,
    r.ifListing,
    r.odds,
    r.implied,
    r.p25,
    r.p75,
    r.farm.net,
    r.farm.net_hour,
    r.farm.verdict,
    r.peers.map((q) => [q.slug, q.mult]),
  ]);
  const checksum = fnv1a(JSON.stringify(compactRows));
  const catRatesOut = {};
  for (const [key, v] of Object.entries(catRates)) catRatesOut[key === '\0null' ? 'null' : key] = pyRound(v, 8);
  const data = {
    version: 'v4',
    snapshot_as_of: snapshot.as_of,
    checksum,
    value_model: { intercept: vm.intercept, slope: vm.slope, centre: vm.centre, n_fit: vm.n_fit, r2: fit.validation.r2 },
    odds_model: {
      coef: om.coef,
      features: om.features,
      regime_cut: om.regime_cut,
      base_rate: om.base_rate,
      base_brier: om.base_brier,
      cv_brier: om.cv_brier,
      cv_folds: om.cv_folds,
    },
    cat_rates: catRatesOut,
    validation: fit.validation,
    ledger: fit.ledger,
    farm: fa,
    rows: compactRows,
  };

  // --- write output (only inside outDir) ---
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: boardRows }, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'dashboard', 'data.js'), `window.TOKEN_RADAR_V4 = ${JSON.stringify(data)};\n`, 'utf8');
  copyTree(join(botDir, 'dashboard'), join(outDir, 'dashboard'));
  // data.js was written first so the copy above must not clobber it:
  // dashboard/ in the repo holds no data.js, only index.html/app.css/app.js.
  copyTree(join(botDir, 'screenshots'), join(outDir, 'screenshots'));
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of rows) verdicts[r.farm.verdict] += 1;
  console.log(
    `token-radar v4: ${rows.length} board rows (${verdicts.FARM} FARM / ${verdicts.MARGINAL} MARGINAL / ${verdicts.SKIP} SKIP), ` +
    `ledger ${rows.length}/${listedCount}/${excluded.length}/${protocols.length}, checksum ${checksum}`,
  );
}

main();
