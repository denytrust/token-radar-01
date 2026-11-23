# Token Radar v3 — Launch Radar

Rebuild of the token-radar-01 entry. v2 (dev 0.9197, 12W 0D 0L) had one
real weakness: its token-odds model barely beat the base rate
(Brier 0.237 vs 0.248). v3 rebuilds the odds and keeps everything else
that worked.

## What changed in v3

**Token odds rebuilt (the only model change).** v2's odds were a logistic
on age, ln TVL, 7d growth and family size. Two things were wrong with it:

1. Its age feature was mis-specified. It treated protocols with no
   `listed_at` date as 30 days old — but those protocols list at 0.788,
   the highest rate of any group, so the term pointed the wrong way.
   v3 replaces the single age term with a dated flag (1 when the snapshot
   carries a date) plus log age for dated protocols.
2. It ignored category. Category carries real signal: Lending lists at
   0.787, Dexs at 0.737, Risk Curators at 0.128. v3 adds the protocol's
   category listing rate as a feature.

New odds model (logistic, fit on all 758 protocols, 5-fold CV):
features [1, ln TVL − 17, growth/10, family size, category rate − base
rate, dated, log age − 6]. Coefficients: intercept −0.569, ln TVL 0.116,
growth −0.173, family 1.370, category 4.046, dated −1.157, age 0.594.
**CV Brier 0.2045 vs base 0.2476** (v2: 0.2370). In-sample Brier 0.1791.

Fitting only on old-enough protocols was tried (to reduce censoring) and
hurts badly (CV Brier 0.30 at age ≥ 180d), so it is not used. Adding chain
count on top of category + age does not help (0.2067 vs 0.2045).

**Value model unchanged.** The size curve (slope −0.404, LOO ×3.33,
walk-forward ×2.53) reproduces v2 exactly on the same snapshot
(2026-11-14 — the kit36 snapshot is identical to the one v2 used, so no
fresher refit was available; a refit on a newer snapshot before submit
may still be needed if the kit updates). Winsorizing the value model was
tested (clips at p1–p99, p2.5–p97.5, p5–p95, |log ratio| ≤ 3/2.5/2, and
Huber IRLS): no variant improves the blind holdout without hurting
leave-one-out and walk-forward, so it is not used. Blind holdout stays
×5.25 (flat ×6.65), ex-extreme ×3.93.

**Board effect.** The better-calibrated odds spread wider (board odds
min 0.019, median 0.366, max 0.888) and the ranking moves: USDD is now
rank 1, Veda 2, Steakhouse 3. Verdicts shift to 23 FARM / 96 MARGINAL /
82 SKIP (v2: 18 / 171 / 12) — the v2 odds were too high on average, so
many marginal farms were flattered; v3 calls more of them SKIP honestly.

## The model (unchanged parts)

**Value model.** ln(mcap/TVL) = −1.275 − 0.404 × (ln TVL − 17), fit on
the 113 listed comps (the 15 newest listings are held out blind).
Bigger TVL, smaller multiple (slope −0.404, bootstrap SE 0.081, 95% CI
[−0.561, −0.239]). Steakhouse Financial (TVL $2.75B): if-listing value
$113.7M (v2: $62.1M — the value model is the same; the difference is the
snapshot's TVL, not the fit).

**Term-by-term, each tested twice (median |log error|):** only the size
curve survives both tests (LOO ×3.33, WF ×2.53 vs flat ×4.75 / ×5.22).
Category, family, growth, age, chain count and the placebo (name length)
all fail at least one test. Full table is in fit.json.

**Evidence.** Honesty: 50.4% of true caps fall inside the printed
P25–P75 range (leave-one-out) — exactly what a P25–P75 interval should
cover. Blind holdout (15 newest listings, never used to fit): size-curve
miss ×5.25 vs flat ×6.65; excluding the 6 extreme-ratio comps, ×3.93.
Top-10 ranks are stable across 200 bootstrap refits: ranks 1–6 never
move.

**Farm verdicts.** Deposit = max($10,000, 0.02% of TVL). Airdrop pool
= 7% of if-listing value; your share = deposit / 10% of TVL, times token
odds. Fees 6% APR, gas $12/week, T-bill 4.5% APR, 12-week horizon,
2 h/week. FARM needs net >= $2,000 and >= $50/hour; SKIP is net <= $0 or
under $25/hour.

**KPI strip + integrity strip.** Six headline numbers on top; all 758
protocols accounted for (201 ranked, 416 already record a token, 141
excluded by the house-style rule). The dashboard recomputes every implied
value, farm number and verdict in the browser and checks them against the
shipped board. Checksum = main.ts.

## Files

- `main.ts` — the entry program (Node 22, stdlib only). Reads
  `/input/snapshot.json` and `fit.json`, writes `/output/board.json`,
  `/output/dashboard/data.js`, copies `dashboard/` and `screenshots/`, and
  writes `/output/dossier.json` via the kit's `vendor/makefun-board.ts`.
- `fit.json` — fitted coefficients, 200 bootstrap refits, validation
  numbers, ledger, farm assumptions. Computed by the local analysis tool
  (`analyze_v3.py`, not part of the entry).
- `dashboard/` — index.html, app.css, app.js (renders `data.js`; the farm
  step template is identical to main.ts).
- `screenshots/` — 1-board, 2-detail, 3-filtered (1440x900 PNG, rendered
  with PIL from the real board data by `render_shots_v3.py`).

## Verification

- Determinism: two local runs produce byte-identical `/output`.
- main.ts reproduces the analysis board exactly (0 mismatches on all 201
  rows: implied, odds, if-listing, P25/P75, verdict, net, rank).
- Gate simulation: all 7 scorer rows pass (dashboard_files, board_file,
  sorted_by_value, coverage, farm_steps, screenshots, dossier_matches by
  construction).

## Honest limits

- The value model explains little (R2 0.19): mcap/TVL varies enormously,
  so the typical miss is still ×3.33 leave-one-out. The numbers are what
  they are; the dashboard prints them rather than hiding them.
- Token odds are better now (Brier 0.2045 vs base 0.2476) but still far
  from sharp: the board odds average 0.378 against a 0.549 base rate.
- The blind holdout miss (×5.25) is worse than leave-one-out (×3.33)
  because 6 of the 15 newest listings have extreme ratios.
- The odds model is censored: protocols that have not listed yet but will
  later are labelled 0, so odds are a lower bound on P(ever lists).
- fit.json is frozen from the 2026-11-14 snapshot. The final snapshot
  (14 Dec) will differ; a refit on the freshest snapshot before submit
  is still advisable if the kit ships a newer one.
