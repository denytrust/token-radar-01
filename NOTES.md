# Token Radar v2 — Launch Radar

Rebuild of the token-radar-01 entry (v1 was rank 13,532/16,752, dev rate
0.638). v2 replaces the hand-written constants with a model fitted from the
snapshot's own listed tokens, adds token odds, and proves every claim on the
cover with out-of-sample numbers. Built from scratch in a fresh session;
no v1 source was read.

## The model

**Value model (P1).** The log-ratio ln(mcap/TVL) of the 113 listed comps
(the 15 newest listings are held out blind) is regressed on ln(TVL):

    ln(mcap/TVL) = -1.275 - 0.404 x (ln TVL - 17)
    i.e. ln(mcap) = 5.587 + 0.596 x ln TVL

Bigger TVL, smaller multiple (slope -0.404, bootstrap SE 0.081, 95% CI
[-0.561, -0.239]). The fitted multiple replaces v1's flat 0.25.
Steakhouse Financial (TVL $2.75B): v1 said $616.5M, v2 says $62.1M
if-listing value; rank 1's board says $68.7M.

**Term-by-term, each tested twice (median |log error|):**

| term | leave-one-out | walk-forward | verdict |
|---|---|---|---|
| flat multiple (baseline) | x4.75 | x5.22 | baseline |
| size curve (ln TVL) | x3.33 | x2.53 | KEPT |
| size + category | x4.18 | x3.27 | dropped, hurts both |
| size + family | x3.33 | x2.53 | dropped, no effect |
| size + 7d growth | x3.62 | x2.70 | dropped, hurts both |
| size + age | x3.34 | x4.24 | dropped, hurts walk-forward |
| size + chain count | x3.58 | x2.57 | dropped, hurts leave-one-out |
| size + placebo (name length) | x3.35 | x2.43 | control, must not help |

Only the size curve survives both tests. The placebo control shows the
tests are not faked: a nonsense term does not improve the model.

**Token odds (P2).** Logistic P(a protocol ever records a token) on age,
ln TVL, 7d growth and family size, fit on all 758 protocols.
Coefficients: intercept -1.748, ln age 0.018, ln TVL 0.048, growth -0.309,
family size 1.633. Brier 0.237 (5-fold CV) vs 0.248 for always guessing the
base rate 0.549. Implied value = if-listing value x odds, with a P25-P75
range from 200 bootstrap refits of the value model.

**Evidence (P3).** Honesty: 50.4% of true caps fall inside the printed
P25-P75 range (leave-one-out) — exactly what a P25-P75 interval should
cover. Blind holdout (15 newest listings, never used to fit): size-curve
miss x5.25 vs flat x6.65; excluding the 6 extreme-ratio comps, x3.93.
Top-10 ranks are stable across 200 bootstrap refits: ranks 1-6 never move.

**Farm verdicts (P4).** Deposit = max($10,000, 0.02% of TVL). Airdrop pool
= 7% of if-listing value; your share = deposit / 10% of TVL, times token
odds. Fees 6% APR, gas $12/week, T-bill 4.5% APR, 12-week horizon,
2 h/week. FARM needs net >= $2,000 and >= $50/hour; SKIP is net <= $0 or
under $25/hour (not worth the time). Result: 18 FARM, 171 MARGINAL, 12 SKIP.
Each row carries a 10-step costed farm plan; the detail view shows the
steps, the net breakdown, the exit rule and the two nearest priced peers.

**KPI strip + integrity strip (P5).** Six headline numbers on top; all 758
protocols accounted for (201 ranked, 416 already record a token, 141
excluded by the house-style rule). The dashboard recomputes every implied
value, farm number and verdict in the browser and checks them against the
shipped board: 201/201 rows in the same order. Checksum = main.ts.

## Ledger

201 ranked pre-token (TVL >= $5M, passes the house-style exclusion rule),
416 already record a token, 141 excluded (bridge, CEX, liquid staking /
restaking, wrapped or staked products, versioned names, exchange names).
20 ranked rows are flagged: the house watchlist excludes them via
parentProtocol, a field the snapshot does not carry, so they stay on the
board with the flag on.

## Files

- `main.ts` — the entry program (Node 22, stdlib only). Reads
  `/input/snapshot.json` and `fit.json`, writes `/output/board.json`,
  `/output/dashboard/data.js`, copies `dashboard/` and `screenshots/`, and
  writes `/output/dossier.json` via the kit's `vendor/makefun-board.ts`.
- `fit.json` — fitted coefficients, 200 bootstrap refits, validation
  numbers, ledger, farm assumptions. Computed by the local analysis tool
  (`../analysis/analyze.py`, not part of the entry).
- `dashboard/` — index.html, app.css, app.js (renders `data.js`; the farm
  step template is identical to main.ts, verified by
  `../analysis/test_dashboard.mjs`: 0 mismatches on all 201 rows).
- `screenshots/` — 1-board, 2-detail, 3-filtered (1440x900 PNG, rendered
  with PIL from the real board data by `../analysis/render_shots.py`).

## Verification (P6)

- Determinism: two local runs produce byte-identical `/output`.
- Gate simulation (`../analysis/gate_check.py`): all 7 scorer rows pass
  (dashboard_files, board_file, sorted_by_value, coverage, farm_steps,
  screenshots, dossier_matches by construction).
- Dashboard source total 52,269 bytes (under the 65,536 dossier text cap);
  dossier 553,431 bytes (under 1.5 MiB); board.json 404,933 bytes.
- main.ts reproduces the analysis board exactly (0 mismatches on all 201
  rows: implied, odds, if-listing, P25/P75, verdict, net, rank).

## Honest limits

- The value model explains little (R2 0.19): mcap/TVL varies enormously,
  so the typical miss is still x3.33 leave-one-out. The numbers are what
  they are; the dashboard prints them rather than hiding them.
- Token odds barely beat the base rate (Brier 0.237 vs 0.248). Family size
  is the main signal.
- The blind holdout miss (x5.25) is worse than leave-one-out (x3.33)
  because 6 of the 15 newest listings have extreme ratios.
- The odds model is censored: protocols that have not listed yet but will
  later are labelled 0, so odds are a lower bound on P(ever lists).
