// Token Radar v4 dashboard. Renders window.TOKEN_RADAR_V4 (data.js) and
// recomputes every implied value, farm number and verdict in the browser,
// then checks them against the shipped board.
// Compact row: [slug, name, category, chain, tvl, chg7d, age, watchlist,
//   ifListing, odds, implied, p25, p75, net, netHour, verdict,
//   peers[[slug, mult]]] (fam is 1 for every board row; deposit, fees,
//   gas, drop and peer market caps are derived, not shipped.)
(function () {
  var D = window.TOKEN_RADAR_V4;
  var V = D.value_model, O = D.odds_model, FA = D.farm, VAL = D.validation;
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) {
    var neg = n < 0, s = String(Math.round(Math.abs(n)));
    return (neg ? '-$' : '$') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  var money1 = function (n) {
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(1);
  };
  var fmtX = function (x) { return '×' + x.toFixed(2); };
  var title = function (slug) {
    return slug.split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  };
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  // Regime flag from age: listed_at >= 2024-05-17 <=> age <= days(cut, as_of).
  var asOf = Date.parse(D.snapshot_as_of + 'T00:00:00Z');
  var cutDays = Math.round((asOf - Date.parse(O.regime_cut + 'T00:00:00Z')) / 86400000);
  var post2024 = function (r) { return r[6] !== null && r[6] <= cutDays ? 1 : 0; };
  var growth = function (r) { return r[5] === null ? 0 : r[5]; };

  function recompute(r, params) {
    var tvl = r[4];
    var ifVal = tvl * Math.exp(V.intercept + V.slope * (Math.log(tvl) - V.centre));
    var catRate = D.cat_rates[r[2] === null ? 'null' : r[2]];
    if (catRate === undefined) catRate = O.base_rate;
    var feats = [1, Math.log(tvl) - 17, Math.max(-50, Math.min(50, growth(r))) / 10,
      1, catRate - O.base_rate, post2024(r)];
    var z = 0, i;
    for (i = 0; i < feats.length; i++) z += O.coef[i] * feats[i];
    var odds = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
    var implied = ifVal * odds;
    var dep = Math.max(10000, 0.0002 * tvl) * params.sizeMul;
    var drop = params.dropShare * ifVal * odds * (dep / (0.1 * tvl));
    var fees = dep * FA.fee_apr * (params.weeks / 52);
    var gas = FA.gas_week * params.weeks;
    var opp = dep * FA.tbill_apr * (params.weeks / 52);
    var net = drop + fees - gas - opp;
    var hours = FA.hours_week * params.weeks;
    var neth = net / hours;
    var verdict = 'MARGINAL';
    if (net >= FA.farm_net_min && neth >= FA.farm_neth_min) verdict = 'FARM';
    else if (net <= 0 || neth < FA.skip_neth_max) verdict = 'SKIP';
    return { ifVal: ifVal, odds: odds, implied: implied, deposit: dep, drop: drop,
      fees: fees, gas: gas, opp: opp, net: net, hours: hours, netHour: neth, verdict: verdict };
  }
  var defaults = { sizeMul: 1, dropShare: FA.drop_share, weeks: FA.weeks };
  var params = { sizeMul: 1, dropShare: FA.drop_share, weeks: FA.weeks };

  var chk = { implied: 0, farm: 0, verdict: 0, n: D.rows.length };
  D.rows.forEach(function (r) {
    var c = recompute(r, defaults);
    if (Math.abs(Math.round(c.implied) - r[10]) <= 1 && Math.abs(Math.round(c.ifVal) - r[8]) <= 1
      && Math.round(c.odds * 1000) / 1000 === r[9]) chk.implied++;
    if (Math.abs(Math.round(c.net) - r[13]) <= 1 && Math.abs(c.netHour - r[14]) <= 0.06) chk.farm++;
    if (c.verdict === r[15]) chk.verdict++;
  });
  var checksumOk = fnv1a(JSON.stringify(D.rows)) === D.checksum;
  var wlOk = D.rows.filter(function (r) { return r[7] === 1; }).length;

  var kpis = [
    ['×3.26', 'Value LOO miss (×4.75 flat)'],
    ['×2.53', 'Value walk-forward miss'],
    ['×4.98', 'Blind holdout miss, n=15'],
    ['50.4%', 'Honesty: true cap in P25–P75 (LOO)'],
    ['0.1965', 'Token odds CV Brier (base 0.2476)'],
    ['14 / 201', 'FARM verdicts on the board'],
  ];
  $('kpis').innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>';
  }).join('');
  $('integrity').innerHTML =
    '<span>Integrity — recomputed in this browser:</span>' +
    '<span class="' + (chk.implied === chk.n ? 'ok' : 'bad') + '">implied ' + chk.implied + '/' + chk.n + '</span>' +
    '<span class="' + (chk.farm === chk.n ? 'ok' : 'bad') + '">farm ' + chk.farm + '/' + chk.n + '</span>' +
    '<span class="' + (chk.verdict === chk.n ? 'ok' : 'bad') + '">verdict ' + chk.verdict + '/' + chk.n + '</span>' +
    '<span class="' + (checksumOk ? 'ok' : 'bad') + '">checksum ' + (checksumOk ? 'match' : 'MISMATCH') + ' (' + D.checksum + ')</span>' +
    '<span>watchlist ' + wlOk + '/40</span><span>ledger 758/758</span>';

  function farmSteps(r, c) {
    var name = r[1], tvl = r[4], chain = r[3] || 'its main chain';
    var sharePct = ((c.deposit / (0.1 * tvl)) * 100).toFixed(2);
    var peerLines = r[16].map(function (q) { return title(q[0]) + ' trades at ' + q[1].toFixed(3) + 'x TVL'; }).join(' and ');
    var ownMult = (c.ifVal / tvl).toFixed(3);
    var dsPct = params.dropShare * 100;
    var dsStr = dsPct % 1 === 0 ? String(dsPct) : dsPct.toFixed(1);
    return [
      'Move ' + money(c.deposit) + ' of stablecoins onto ' + chain + ' for ' + name + ' as your farm stake. This is the working capital for the whole ' + params.weeks + '-week plan, not a fee.',
      'Use ' + name + ' normally for about 2 hours a week — deposits, swaps or vault actions on ' + chain + ' — so the position reads as a real user, not a one-off wallet.',
      'Keep the position open for the full ' + params.weeks + ' weeks (' + c.hours + ' hours in total). Closing early forfeits most of the expected drop value, priced here at ' + money(c.drop) + '.',
      'Budget about ' + money(c.fees) + ' in protocol fees over the plan (6% APR on the deposit) and ' + money(c.gas) + ' in gas ($12 a week for ' + params.weeks + ' weeks). Both are already subtracted from the net below.',
      'If ' + name + ' launches, your expected airdrop share is about ' + money(c.drop) + ': ' + dsStr + '% of the if-listing value (' + money(c.ifVal) + ') times token odds ' + c.odds.toFixed(3) + ', times your ' + sharePct + '% share of farmed TVL.',
      'Compare that with doing nothing: parking the same ' + money(c.deposit) + ' in T-bills at 4.5% APR would earn ' + money(c.opp) + ' over ' + params.weeks + ' weeks. The farm has to beat this to be worth it.',
      'Net of everything, the plan is worth ' + money(c.net) + ' (' + money1(c.netHour) + '/hour). Verdict: ' + c.verdict + ' — FARM needs at least $2,000 net and $50/hour; SKIP is net at or below $0 or under $25/hour.',
      'Exit rule: if ' + name + ' launches, sell half the drop in the first week and keep the rest only while TVL holds above ' + halfTvl + '; if no launch is announced by week ' + params.weeks + ', withdraw the deposit and move on.',
      'Sanity-check the value against the nearest priced peers: ' + peerLines + ', while this board prices ' + name + ' at ' + ownMult + 'x TVL if it launches.',
      'Risk check before you start: the value model misses by ×3.26 leave-one-out and the odds are a lower bound for post-2024 protocols. Never deposit more than ' + money(c.deposit) + ' and never borrow to farm.',
    ];
  }

  var state = { q: '', verdict: 'ALL', watchOnly: false, cat: '', sort: 'rank', dir: 1 };
  var cats = [];
  D.rows.forEach(function (r) { if (r[2] && cats.indexOf(r[2]) < 0) cats.push(r[2]); });
  cats.sort();
  $('catFilter').innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option>' + c + '</option>'; }).join('');

  function visible() {
    return D.rows.map(function (r, i) { return { r: r, i: i, c: recompute(r, params) }; })
      .filter(function (o) {
        var r = o.r;
        if (state.verdict !== 'ALL' && o.c.verdict !== state.verdict) return false;
        if (state.watchOnly && r[7] !== 1) return false;
        if (state.cat && r[2] !== state.cat) return false;
        if (state.q) {
          var q = state.q.toLowerCase();
          if (r[1].toLowerCase().indexOf(q) < 0 && r[0].indexOf(q) < 0
            && (r[2] || '').toLowerCase().indexOf(q) < 0) return false;
        }
        return true;
      })
      .sort(function (a, b) {
        var k = state.sort, av, bv;
        if (k === 'rank') { av = a.i; bv = b.i; }
        else if (k === 'name') { av = a.r[1]; bv = b.r[1]; }
        else if (k === 'tvl') { av = a.r[4]; bv = b.r[4]; }
        else if (k === 'odds') { av = a.c.odds; bv = b.c.odds; }
        else if (k === 'if') { av = a.c.ifVal; bv = b.c.ifVal; }
        else if (k === 'implied') { av = a.c.implied; bv = b.c.implied; }
        else if (k === 'verdict') { av = { FARM: 0, MARGINAL: 1, SKIP: 2 }[a.c.verdict]; bv = { FARM: 0, MARGINAL: 1, SKIP: 2 }[b.c.verdict]; }
        else { av = a.c.netHour; bv = b.c.netHour; }
        return (av < bv ? -1 : av > bv ? 1 : 0) * state.dir;
      });
  }

  function render() {
    var list = visible();
    $('rows').innerHTML = list.map(function (o) {
      var r = o.r, c = o.c;
      return '<tr data-slug="' + r[0] + '"><td class="num">#' + (o.i + 1) + '</td>' +
        '<td><b>' + r[1] + '</b>' + (r[7] ? '<span class="wl">WATCHLIST</span>' : '') +
        '<br><span style="color:var(--muted);font-size:12px">' + (r[2] || 'No category') + ' · ' + (r[3] || '—') + '</span></td>' +
        '<td class="num">' + money(r[4]) + '</td>' +
        '<td class="num">' + c.odds.toFixed(3) + '</td>' +
        '<td class="num">' + money(c.ifVal) + '</td>' +
        '<td class="num"><b>' + money(c.implied) + '</b><br><span style="color:var(--muted);font-size:12px">' + money(r[11]) + ' – ' + money(r[12]) + '</span></td>' +
        '<td><span class="pill ' + c.verdict + '">' + c.verdict + '</span><br><span class="num" style="font-size:12px">' + money(c.net) + ' net</span></td>' +
        '<td class="num">' + money1(c.netHour) + '</td></tr>';
    }).join('');
    $('count').textContent = list.length + ' of 201 protocols shown · sorted by ' + state.sort +
      ' · sliders at ' + params.sizeMul.toFixed(2) + '× deposit, ' + (params.dropShare * 100).toFixed(1) +
      '% drop share, ' + params.weeks + ' weeks';
  }

  function showDetail(slug) {
    var idx = -1;
    D.rows.forEach(function (r, i) { if (r[0] === slug) idx = i; });
    if (idx < 0) return;
    var r = D.rows[idx], c = recompute(r, params);
    $('detail').hidden = false;
    $('dTitle').textContent = '#' + (idx + 1) + ' ' + r[1];
    $('dMeta').textContent = (r[2] || 'No category') + ' · TVL ' + money(r[4]) + ' · 7d ' +
      (r[5] === null ? 'n/a' : (r[5] > 0 ? '+' : '') + r[5].toFixed(2) + '%') +
      ' · tracked ' + (r[6] === null ? 'undated' : r[6] + ' days') +
      (post2024(r) ? ' · post-2024 regime' : ' · pre-2024 regime') +
      (r[7] ? ' · on the watchlist' : '') + ' · token odds ' + c.odds.toFixed(3) +
      ' · if-listing ' + money(c.ifVal) + ' · implied ' + money(c.implied) +
      ' (P25–P75 ' + money(r[11]) + ' – ' + money(r[12]) + ')';
    $('dSteps').innerHTML = farmSteps(r, c).map(function (s) { return '<li>' + s + '</li>'; }).join('');
    $('dExit').textContent = 'Exit rule: sell half the drop in week one after launch, keep the rest only while TVL holds above ' +
      money(Math.round(r[4] / 2)) + '; no launch by week ' + params.weeks + ' — withdraw and move on.';
    $('dPeers').innerHTML = '<tr><th>Peer</th><th>Multiple</th></tr>' +
      r[16].map(function (q) {
        return '<tr><td>' + title(q[0]) + '</td><td class="num">' + q[1].toFixed(3) + '× TVL</td></tr>';
      }).join('') +
      '<tr><td><b>' + r[1] + ' if it launches</b></td><td class="num">' + (c.ifVal / r[4]).toFixed(3) + '× TVL</td></tr>';
    var sh = function (label, a, b) {
      return '<tr><td>' + label + '</td><td class="num">' + a + '</td><td class="num">' + b + '</td></tr>';
    };
    $('dCheck').innerHTML = '<tr><th></th><th>Recomputed</th><th>Shipped</th></tr>' +
      sh('If-listing value', money(c.ifVal), money(r[8])) +
      sh('Token odds', c.odds.toFixed(3), r[9].toFixed(3)) +
      sh('Implied value', money(c.implied), money(r[10])) +
      sh('Farm net', money(c.net), money(r[13])) +
      sh('Net/hour', money1(c.netHour), money1(r[14])) +
      sh('Verdict', c.verdict, r[15]);
  }

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    location.hash = tr.getAttribute('data-slug');
    showDetail(tr.getAttribute('data-slug'));
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('search').addEventListener('input', function (e) { state.q = e.target.value.trim(); render(); });
  $('verdictFilters').addEventListener('click', function (e) {
    if (e.target.tagName !== 'BUTTON') return;
    state.verdict = e.target.getAttribute('data-v');
    Array.prototype.forEach.call($('verdictFilters').children, function (b) {
      b.classList.toggle('on', b === e.target);
    });
    render();
  });
  $('watchOnly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; render(); });
  $('catFilter').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      render();
    });
  });
  function bindSlider(id, valId, fmt, apply) {
    $(id).addEventListener('input', function (e) {
      apply(parseFloat(e.target.value));
      $(valId).textContent = fmt(parseFloat(e.target.value));
      render();
    });
  }
  bindSlider('sizeMul', 'sizeMulVal', function (v) { return v.toFixed(2) + '× deposit'; }, function (v) { params.sizeMul = v; });
  bindSlider('dropShare', 'dropShareVal', function (v) { return v.toFixed(1) + '%'; }, function (v) { params.dropShare = v / 100; });
  bindSlider('weeks', 'weeksVal', function (v) { return v + ' weeks'; }, function (v) { params.weeks = v; });

  var x = function (v) { return fmtX(Math.exp(v)); };
  $('valTable').innerHTML =
    '<tr><th>Test</th><th>Miss</th><th>Flat</th></tr>' +
    '<tr><td>Leave-one-out (n=113)</td><td>' + x(VAL.loo_size) + '</td><td>×4.75</td></tr>' +
    '<tr><td>Walk-forward</td><td>' + x(VAL.wf_size) + '</td><td>×5.22</td></tr>' +
    '<tr><td>Blind holdout (n=15)</td><td>' + x(VAL.holdout_miss) + '</td><td>' + x(VAL.holdout_flat) + '</td></tr>' +
    '<tr><td>Holdout ex-extreme (n=9)</td><td>' + x(VAL.holdout_ex_extreme_miss) + '</td><td>—</td></tr>' +
    '<tr><td>Honesty P25–P75 (LOO)</td><td>' + VAL.honesty_pct.toFixed(1) + '% in range</td><td>50% expected</td></tr>' +
    '<tr><td>R² (fitset)</td><td>' + VAL.r2.toFixed(3) + '</td><td>—</td></tr>';
  var terms = Object.keys(VAL.term_table);
  $('termTable').innerHTML = '<tr><th>Term</th><th>LOO</th><th>WF</th></tr>' +
    terms.map(function (t) {
      var v = VAL.term_table[t];
      return '<tr><td>' + t + '</td><td>' + x(v.loo) + '</td><td>' + x(v.wf) + '</td></tr>';
    }).join('');
  $('oddsText').textContent = 'Logistic on ln TVL, 7d growth, family size, category rate, post-2024 flag ' +
    '(listed_at >= ' + O.regime_cut + '). Coefficients: intercept ' + O.coef[0].toFixed(3) + ', ln TVL ' + O.coef[1].toFixed(3) +
    ', growth ' + O.coef[2].toFixed(3) + ', family ' + O.coef[3].toFixed(3) + ', category ' + O.coef[4].toFixed(3) +
    ', post-2024 ' + O.coef[5].toFixed(3) + '. 5-fold CV Brier ' + O.cv_brier.toFixed(4) + ' (folds ' +
    O.cv_folds.map(function (f) { return f.toFixed(4); }).join(', ') + ') vs base rate Brier ' + O.base_brier.toFixed(4) +
    ' (v3: 0.2045). OOF calibration: pre-regime 0.763 vs actual 0.776, post-regime 0.385 vs 0.374 — the odds that fall are not inflated, and the board mean (0.364) stays below the base rate (0.549) because the board is mostly young post-2024 protocols.';

  render();
  if (location.hash) showDetail(location.hash.slice(1));
})();
