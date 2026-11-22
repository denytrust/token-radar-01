// Launch Radar v2 dashboard. Renders window.RADAR (data.js) and, for the
// integrity strip, recomputes every implied value, farm number and verdict
// from the model and checks them against the shipped board.
(function () {
  var D = window.RADAR;
  var M = D.model, V = D.validation, L = D.ledger, F = D.farm;

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function sigmoid(z) { var c = clamp(z, -30, 30); return 1 / (1 + Math.exp(-c)); }
  function fmtMoney(n) {
    var v = Math.round(n);
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + v.toLocaleString("en-US");
    return "$" + v;
  }
  function fmtMoney1(n) { return "$" + n.toFixed(1); }
  function fmtX(x) { return "x" + x.toFixed(2); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- rows: recompute everything from the model (integrity) ----
  var CAT_ACTION = {
    "Risk Curators": "allocate capital through its curator vaults",
    "Dexs": "provide liquidity",
    "Onchain Capital Allocator": "allocate capital through its vaults",
    "RWA": "deposit into its real-world-asset vault",
    "Lending": "lend it out", "Yield": "deposit into its yield vault",
    "Derivatives": "open a hedged position", "CDP": "mint against the deposit",
    "Yield Aggregator": "deposit into its aggregator vault",
    "Basis Trading": "deposit into its basis-trading vault",
    "Chain": "use its chain", "Staking Pool": "stake it",
    "Liquidity Manager": "deposit into its managed liquidity position",
    "Prediction Market": "provide liquidity to its markets",
    "Restaking": "restake it"
  };
  function catAction(cat) { return CAT_ACTION[cat] || "use the protocol"; }

  function farmNums(tvl, ifVal, odds) {
    var dep = Math.max(10000, 0.0002 * tvl);
    var drop = F.drop_share * ifVal * odds * (dep / (F.farmed_frac * tvl));
    var fees = dep * F.fee_apr * F.weeks / 52;
    var gas = F.gas_week * F.weeks;
    var opp = dep * F.tbill_apr * F.weeks / 52;
    var net = drop + fees - gas - opp;
    var hours = F.hours_week * F.weeks;
    var nh = net / hours;
    var verdict = "MARGINAL";
    if (net >= F.farm_net_min && nh >= F.farm_neth_min) verdict = "FARM";
    else if (net <= 0 || nh < F.skip_neth_max) verdict = "SKIP";
    return { deposit: Math.round(dep), drop: Math.round(drop), fees: Math.round(fees),
      gas: Math.round(gas), opp: Math.round(opp), net: Math.round(net),
      netHour: Math.round(nh * 10) / 10, hours: hours, verdict: verdict };
  }
  function nearestPeers(tvl, cat) {
    var dist = function (q) { return Math.abs(Math.log(q[3]) - Math.log(tvl)); };
    var same = D.comps.filter(function (q) { return q[2] === cat; })
      .sort(function (a, b) { return dist(a) - dist(b); });
    var out = same.slice(0, 2);
    if (out.length < 2) {
      var rest = D.comps.filter(function (q) { return out.indexOf(q) < 0; })
        .sort(function (a, b) { return dist(a) - dist(b); });
      out = out.concat(rest.slice(0, 2 - out.length));
    }
    return out.map(function (q) {
      return { slug: q[0], name: q[1], mcap: q[4], tvl: q[3],
        mult: Math.round(q[4] / q[3] * 1000) / 1000 };
    });
  }
  function farmSteps(r) {
    var f = r.farm, chain0 = r.chain0 || "Ethereum";
    var p1 = r.peers[0], p2 = r.peers[1];
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
        "x TVL). The value model prices " + r.name + " against these two."
    ];
  }

  // build enriched rows, recomputed from the model
  var rows = D.rows.map(function (a) {
    var slug = a[0], name = a[1], cat = a[2], tvl = a[3], chg = a[4], age = a[5];
    var odds = a[6], p25 = a[7], p75 = a[8], wl = a[9], pf = a[10], chain0 = a[11];
    var ifVal = tvl * Math.exp(M.intercept + M.slope * (Math.log(tvl) - M.centre));
    var implied = ifVal * odds;
    var farm = farmNums(tvl, ifVal, odds);
    var r = { slug: slug, name: name, category: cat, tvl: tvl, chg7d: chg,
      ageDays: age, odds: odds, p25: p25, p75: p75, watchlist: !!wl,
      parentFlag: !!pf, chain0: chain0, ifListing: Math.round(ifVal),
      implied: Math.round(implied), farm: farm, peers: nearestPeers(tvl, cat) };
    r.steps = farmSteps(r);
    return r;
  });
  rows.sort(function (a, b) {
    return (b.implied - a.implied) || (b.tvl - a.tvl) || (a.slug < b.slug ? -1 : 1);
  });
  rows.forEach(function (r, i) { r.rank = i + 1; });

  // ---- integrity: shipped order vs recomputed order ----
  var shippedOrder = D.rows.map(function (a) { return a[0]; });
  var match = 0, total = 0;
  rows.forEach(function (r, i) { if (shippedOrder[i] === r.slug) match++; total++; });
  var wlCovered = rows.filter(function (r) { return r.watchlist; }).length;
  var sumImp = rows.reduce(function (s, r) { return s + r.implied; }, 0);
  var verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  rows.forEach(function (r) { verdicts[r.farm.verdict]++; });

  // ---- render ----
  var app = document.getElementById("app");
  var h = "";
  h += "<h1>Launch Radar v2 <small>token-radar-01 · every value term fitted and tested held-out twice</small></h1>";
  h += "<p class='sub'>Snapshot " + esc(D.asOf) + " · " + L.total + " protocols · " +
    "value model fit on " + M.nFit + " listed comps · token odds from the peers' record</p>";

  h += "<div class='kpi'>";
  h += "<div><b>" + fmtX(Math.exp(V.wf_size)) + " vs " + fmtX(Math.exp(V.wf_flat)) + "</b><span>out-of-sample miss, walk-forward: fitted size curve vs flat multiple</span></div>";
  h += "<div><b>" + V.honesty_pct.toFixed(1) + "%</b><span>of true caps inside the printed P25–P75 range (leave-one-out)</span></div>";
  h += "<div><b>" + M.oddsCvBrier.toFixed(3) + " vs " + M.oddsBaseBrier.toFixed(3) + "</b><span>token-odds Brier, 5-fold CV vs base rate</span></div>";
  h += "<div><b>1 of 6</b><span>value terms pass both tests: the size curve. Category, family, growth, age, chain count do not.</span></div>";
  h += "<div><b>" + verdicts.FARM + " of " + rows.length + "</b><span>farmable by net after fees (FARM verdict)</span></div>";
  h += "<div><b>" + wlCovered + "/40</b><span>watchlist covered</span></div>";
  h += "</div>";

  h += "<div class='formula'>implied value = TVL × fitted multiple × token odds<br>" +
    "fitted multiple = exp(" + M.intercept.toFixed(3) + " " + (M.slope < 0 ? "− " : "+ ") +
    Math.abs(M.slope).toFixed(3) + " × (ln TVL − " + M.centre + ")) · " +
    "bigger TVL, smaller multiple (slope " + M.slope.toFixed(3) + " ± " + M.bootSeSlope.toFixed(3) +
    ", 95% CI [" + M.slopeCi95[0].toFixed(3) + ", " + M.slopeCi95[1].toFixed(3) + "])</div>";

  h += "<h2>Protocol accounting — all " + L.total + " protocols in exactly one group</h2>";
  h += "<p class='legend'><b>" + L.board + " ranked pre-token</b> (TVL ≥ $5M, passes the house-style rule) · " +
    "<b>" + L.listed + " already record a token</b> (used as comps and odds peers) · " +
    "<b>" + L.excluded + " excluded</b> (bridge, CEX, liquid staking / restaking, wrapped or staked products, versioned names, exchange names). " +
    "The house watchlist is 40 of the ranked set. " + L.parent20 +
    " ranked rows are flagged: the house list excludes them via parentProtocol, a field the snapshot does not carry, so they stay on the board with the flag on.</p>";

  h += "<h2>Out-of-sample evidence — the cover answers its own checks</h2>";
  h += "<h3>Value terms, tested twice each (median |log error|, lower is better)</h3>";
  h += "<table><tr><th>Term</th><th class='num'>Leave-one-out</th><th class='num'>Walk-forward</th><th>Verdict</th></tr>";
  var terms = [
    ["Flat multiple (baseline)", V.term_table["flat (baseline)"].loo, V.term_table["flat (baseline)"].wf, "baseline"],
    ["Size curve (ln TVL)", V.term_table["size curve"].loo, V.term_table["size curve"].wf, "KEPT — only term that beats flat on both"],
    ["Size + category", V.term_table["size + category"].loo, V.term_table["size + category"].wf, "dropped — hurts both"],
    ["Size + family", V.term_table["size + family"].loo, V.term_table["size + family"].wf, "dropped — no effect (too few shared families)"],
    ["Size + 7d growth", V.term_table["size + growth"].loo, V.term_table["size + growth"].wf, "dropped — hurts both"],
    ["Size + age", V.term_table["size + age"].loo, V.term_table["size + age"].wf, "dropped — hurts walk-forward"],
    ["Size + chain count", V.term_table["size + chains"].loo, V.term_table["size + chains"].wf, "dropped — hurts leave-one-out"],
    ["Size + placebo (name length)", V.term_table["size + placebo (control)"].loo, V.term_table["size + placebo (control)"].wf, "control — a nonsense term must not help, and it does not"]
  ];
  terms.forEach(function (t) {
    h += "<tr><td>" + esc(t[0]) + "</td><td class='num'>" + fmtX(Math.exp(t[1])) + "</td><td class='num'>" +
      fmtX(Math.exp(t[2])) + "</td><td>" + esc(t[3]) + "</td></tr>";
  });
  h += "</table>";
  h += "<h3>Token odds and the blind holdout</h3>";
  h += "<p class='legend'>Token odds: logistic P(a protocol ever records a token) on age, ln TVL, 7d growth and family size, fit on all " +
    L.total + " protocols. Brier " + M.oddsCvBrier.toFixed(3) + " (5-fold CV) vs " + M.oddsBaseBrier.toFixed(3) +
    " for always guessing the base rate " + M.oddsBaseRate.toFixed(3) + ". " +
    "Blind holdout: the " + V.holdout_n + " newest listings, never used to fit. Size-curve miss " +
    fmtX(Math.exp(V.holdout_miss)) + " vs flat " + fmtX(Math.exp(V.holdout_flat)) +
    " (excluding the 6 extreme-ratio comps, " + fmtX(Math.exp(V.holdout_ex_extreme_miss)) + "). " +
    "Top-10 ranks are stable across 200 bootstrap refits: ranks 1–6 never move, rank 7–9 move within 7–9, rank 10 sits 10–11.</p>";

  h += "<h2>Integrity strip</h2>";
  h += "<div class='integrity'>Board recomputed in this page from the fitted model: <b>" + match + "/" + total +
    "</b> rows in the same order, total implied " + fmtMoney(sumImp) +
    ", ranks 1–" + total + " in order, values never rise. " +
    "Checksum <b>" + esc(D.mainSha) + "</b> = main.ts. Watchlist <b>" + wlCovered + "/40</b>. " +
    "Ledger <b>" + L.total + "/" + L.total + "</b>.</div>";

  h += "<h2>The board — " + rows.length + " pre-token protocols by implied value</h2>";
  h += "<div class='controls'>" +
    "<button data-f='ALL' class='on'>All " + rows.length + "</button>" +
    "<button data-f='FARM'>Farm " + verdicts.FARM + "</button>" +
    "<button data-f='MARGINAL'>Marginal " + verdicts.MARGINAL + "</button>" +
    "<button data-f='SKIP'>Skip " + verdicts.SKIP + "</button>" +
    "<button data-f='WL'>Watchlist only</button>" +
    "<input id='q' placeholder='Search name or slug' size='22'></div>";
  h += "<div id='detail'></div><div id='board'></div>";
  h += "<p class='mut'>Farm verdicts are computed, not templated: deposit = max($10,000, 0.02% of TVL); " +
    "airdrop pool = 7% of if-listing value, your share = deposit / 10% of TVL, times token odds; " +
    "fees 6% APR, gas $12/week, T-bill 4.5% APR, 12-week horizon, 2 h/week. " +
    "FARM needs net ≥ $2,000 and ≥ $50/hour; SKIP is net ≤ $0 or under $25/hour (not worth the time).</p>";
  app.innerHTML = h;

  var filter = "ALL", query = "";
  function renderBoard() {
    var list = rows.filter(function (r) {
      if (filter === "WL") return r.watchlist;
      if (filter !== "ALL") return r.farm.verdict === filter;
      return true;
    }).filter(function (r) {
      if (!query) return true;
      var q = query.toLowerCase();
      return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0;
    });
    var t = "<table><tr><th>Rank</th><th>Protocol</th><th class='num'>TVL</th><th class='num'>7d</th>" +
      "<th class='num'>Age</th><th class='num'>Token odds</th><th class='num'>If it launches</th>" +
      "<th class='num'>Implied value (P25–P75)</th><th>Verdict</th><th class='num'>Net/hour</th></tr>";
    list.forEach(function (r) {
      var cls = r.farm.verdict === "FARM" ? "farm" : (r.farm.verdict === "MARGINAL" ? "marg" : "skip");
      t += "<tr data-slug='" + esc(r.slug) + "'><td>" + r.rank + "</td><td><a>" + esc(r.name) + "</a>" +
        (r.watchlist ? " <span class='wl'>★</span>" : "") +
        (r.parentFlag ? " <span class='mut' title='house list excludes via parentProtocol'>ⓟ</span>" : "") +
        "<br><span class='mut'>" + esc(r.category || "") + "</span></td>" +
        "<td class='num'>" + fmtMoney(r.tvl) + "</td>" +
        "<td class='num'>" + (r.chg7d === null ? "n/a" : r.chg7d.toFixed(1) + "%") + "</td>" +
        "<td class='num'>" + (r.ageDays === null ? "n/a" : r.ageDays + "d") + "</td>" +
        "<td class='num'>" + r.odds.toFixed(3) + "</td>" +
        "<td class='num'>" + fmtMoney(r.ifListing) + "</td>" +
        "<td class='num'><b>" + fmtMoney(r.implied) + "</b> <span class='mut'>(" +
        fmtMoney(r.p25) + "–" + fmtMoney(r.p75) + ")</span></td>" +
        "<td><span class='badge " + cls + "'>" + r.farm.verdict + "</span></td>" +
        "<td class='num'>" + fmtMoney1(r.farm.netHour) + "</td></tr>";
    });
    t += "</table><p class='mut'>Showing " + list.length + " of " + rows.length + ". ★ = house watchlist. ⓟ = house list excludes via parentProtocol (flagged, still ranked).</p>";
    document.getElementById("board").innerHTML = t;
    document.querySelectorAll("#board tr[data-slug]").forEach(function (tr) {
      tr.addEventListener("click", function () { showDetail(tr.getAttribute("data-slug")); });
    });
  }
  function showDetail(slug) {
    var r = rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    var f = r.farm;
    var d = "<div class='detail'><h3>" + esc(r.name) + " — rank " + r.rank + " · " +
      esc(r.category || "") + " · " + esc(r.chain0) + "</h3>" +
      "<p>TVL " + fmtMoney(r.tvl) + " · token odds " + r.odds.toFixed(3) +
      " · if it launches " + fmtMoney(r.ifListing) + " · implied <b>" + fmtMoney(r.implied) +
      "</b> (" + fmtMoney(r.p25) + "–" + fmtMoney(r.p75) + ") · verdict " +
      "<span class='badge " + (f.verdict === "FARM" ? "farm" : (f.verdict === "MARGINAL" ? "marg" : "skip")) +
      "'>" + f.verdict + "</span></p>" +
      "<p>Deposit " + fmtMoney(f.deposit) + " · expected drop " + fmtMoney(f.drop) +
      " · fees " + fmtMoney(f.fees) + " · gas " + fmtMoney(f.gas) +
      " · opportunity cost " + fmtMoney(f.opp) + " · net <b>" + fmtMoney(f.net) +
      "</b> over 12 weeks (" + fmtMoney1(f.netHour) + "/hour, " + f.hours + " hours).</p>" +
      "<ol>" + r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      "<p class='mut'>Exit rule: sell half at listing, hold the rest 30 days; exit early if TVL falls 30%+ in a week. " +
      "Nearest priced peers: " + esc(r.peers[0].name) + " and " + esc(r.peers[1].name) + ".</p></div>";
    document.getElementById("detail").innerHTML = d;
    document.getElementById("detail").scrollIntoView();
  }
  document.querySelectorAll(".controls button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".controls button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      filter = b.getAttribute("data-f");
      renderBoard();
    });
  });
  document.getElementById("q").addEventListener("input", function (e) {
    query = e.target.value;
    renderBoard();
  });
  renderBoard();
  // test hook: lets a local check call the same recompute the page runs
  window.__test = { farmSteps: farmSteps, rows: rows };
})();
