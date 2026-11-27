# Token Radar v4 — Launch Radar

v4 is an honest incremental fix of v3, not a rebuild. Two model changes,
both passing the acceptance rule (improve one validation metric materially
without harming any other):

1. **Odds: + post-2024 regime flag** (`listed_at >= 2024-05-17`). CV Brier
   0.2045 → **0.1965** (paired bootstrap 90% CI of the per-protocol Brier
   difference [−0.0124, −0.0029], P(improves) = 1.00). The flag is a
   censoring correction the data supports: the age gradient is a calendar
   cliff (pre-May-2024 cohorts list at ~0.78, post at ~0.37), not smooth
   exposure, so a single-regime survival correction — which would have
   inflated board odds to 0.545 — was tested and rejected.
2. **Value: + family-TVL correction.** Comps whose token is family-level
   but whose TVL is one version slice (aave-v2, sushiswap) are fit on
   family-total TVL. LOO ×3.33 → ×3.26, holdout ×5.25 → ×4.98, WF
   unchanged ×2.53, rank stability improves.

## The model

**Value model.** ln(mcap/TVL_fam) = −1.3177 − 0.3868 × (ln TVL_fam − 17),
fit on the 113 listed comps (the 15 newest listings are held out blind).
Bigger TVL, smaller multiple (slope −0.3868, bootstrap SE 0.083, 95% CI
[−0.553, −0.233]). R² = 0.145 — note: v3's NOTES claimed R² 0.19, which
does not reproduce on this snapshot (v3's model refits at 0.140 the same
way); v4 reports 0.145 computed the same way, so the comparison is
apples-to-apples.

**Token odds.** Logistic, fit on all 758 protocols, 5-fold CV (folds by
index mod 5, category rate computed in-fold). Features [1, ln TVL − 17,
growth/10 (clip ±50), family size, category rate − base rate, post2024].
Coefficients: intercept −0.558, ln TVL 0.113, growth −0.185, family 1.365,
category 3.873, post2024 −1.447. **CV Brier 0.1965** (folds 0.2044, 0.1672,
0.2087, 0.1984, 0.2036) vs base 0.2476. In-sample Brier 0.1736. The v3
dated/age terms are removed — the regime flag absorbs the age/cohort
signal (0.1969 → 0.1965 without them). The flag is a calendar feature,
not age: the cut stays 2024-05-17 on the final snapshot.

**Term-by-term, each tested twice (median |log error|):** only the size
curve + famTVL survives both tests. Category, family size (a 2-point
artifact: aave-v2 and sushiswap only), growth in the value curve (WF
improves 0.929 → 0.785 but its shipped coefficient is +0.05 ± 0.47 and it
destroys rank stability — top-10 bootstrap spread 5.8 → 25.5), age,
chains, and rel-to-category-median all fail at least one test or were
rejected with numbers. Full table is in fit.json.

**Evidence.** Honesty: 50.4% of true caps fall inside the printed
P25–P75 range (leave-one-out) — exactly what a P25–P75 interval should
cover. Blind holdout (15 newest listings, never used to fit): size-curve
miss ×4.98 vs flat ×6.20; excluding the 6 extreme-ratio comps, ×3.82.
Top-10 ranks are stable across 200 bootstrap refits (mean spread ~6.5).

**Farm verdicts.** Deposit = max($10,000, 0.02% of TVL). Airdrop pool
= 7% of if-listing value; your share = deposit / 10% of TVL, times token
odds. Fees 6% APR, gas $12/week, T-bill 4.5% APR, 12-week horizon,
2 h/week. FARM needs net >= $2,000 and >= $50/hour; SKIP is net <= $0 or
under $25/hour. Verdicts: 14 FARM / 98 MARGINAL / 89 SKIP.

**Board.** 201 ranked rows (USDD #1 at $27.13M implied, odds 0.414);
board implied total $755,421,292; board odds min 0.035, median 0.354,
max 0.885, mean 0.364. Ledger: 201 ranked / 416 listed / 141 excluded /
758 total; watchlist 40/40.

**KPI strip + integrity strip.** Six headline numbers on top; all 758
protocols accounted for. The dashboard recomputes every implied value,
farm number and verdict in the browser and checks them against the
shipped board. Checksum = main.ts.

## Files

- `main.ts` — the entry program (Node 22, stdlib only). Reads
  `/input/snapshot.json` and `fit.json`, writes `/output/board.json`,
  `/output/dashboard/data.js`, copies `dashboard/` and `screenshots/`, and
  writes `/output/dossier.json` via the kit's `vendor/makefun-board.ts`.
- `fit.json` — fitted coefficients, 200 bootstrap refits, validation
  numbers, ledger, farm assumptions. Computed by the local analysis tool
  (`analysis/analyze_v4.py`, not part of the entry).
- `dashboard/` — index.html, app.css, app.js (renders `data.js`; the farm
  step template is identical to main.ts).
- `screenshots/` — 1-board, 2-detail, 3-filtered (1440x900 PNG, rendered
  with PIL from the real board data by `analysis/render_shots.py`).

## Verification

- Determinism: two local runs produce byte-identical `/output`.
- main.ts reproduces the analysis board exactly (0 mismatches on all 201
  rows: implied, odds, if-listing, P25/P75, verdict, net, rank).
- Gate check (local, kit60 CLI): see TEST-REPORT.md.

## Honest limits

- The value model explains little (R² 0.145): mcap/TVL varies enormously,
  so the typical miss is still ×3.26 leave-one-out, ×4.98 on the blind
  holdout. The numbers are what they are; the dashboard prints them
  rather than hiding them.
- Token odds are better now (Brier 0.1965 vs base 0.2476) but still far
  from sharp: the board odds average 0.364 against a 0.549 base rate.
- The blind holdout miss (×4.98) is worse than leave-one-out (×3.26)
  because 6 of the 15 newest listings have extreme ratios.
- The odds model is censored: protocols that have not listed yet but will
  later are labelled 0, so odds are a lower bound on P(ever lists) — and
  the regime reading of the age gradient is one untestable assumption:
  if post-2024 is only slow exposure, board odds are too low.
- Honesty is uneven by size (small 67% / mid 43% / large 50% coverage);
  a heteroskedastic interval did not fix it.
- The v4-over-v3 gain is small statistically: only the Brier gain is
  solid (paired CI excludes 0). v4 is v3 + one flag + one measurement
  fix, not a leap — expect a small dev move, not a jump.
- fit.json is frozen from the 2026-11-14 snapshot. The final snapshot
  (14 Dec) will differ; refit on the freshest snapshot before submit
  (run `analysis/analyze_v4.py` on it — coefficients change; the regime
  cut, family-TVL rule and farm math do not).
