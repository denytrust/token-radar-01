# Launch Radar v4 — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/denytrust/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/denytrust/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty. It ranks the
snapshot's pre-token protocols by implied value, shows how to farm each
one, and proves every claim on the cover with out-of-sample numbers.

**The model (v4).** The value of a token that does not exist yet is fitted,
not guessed: ln(mcap/TVL) is regressed on ln(TVL) over the 113 listed comps,
so bigger TVL means a smaller multiple (slope −0.387, R² 0.145). Two honest
fixes over v3: (1) comps whose token is family-level but whose TVL is one
version slice (aave-v2, sushiswap) are fit on family-total TVL; (2) the
token odds add a post-2024 regime flag (`listed_at >= 2024-05-17`) — the
age gradient is a calendar cliff, not smooth exposure, so a naive survival
correction would have inflated board odds to 0.545 and was rejected with
the evidence. CV Brier **0.1965** vs base 0.2476 (v3: 0.2045). Implied
value is the if-listing value times the token odds. The cover prints the
miss numbers, the honesty check, the Brier score and the blind-holdout
result — including the limits (see NOTES.md).

**Farm verdicts.** Every row gets FARM / MARGINAL / SKIP from a net computed
after fees: a sized deposit, an airdrop share, fee income, gas and the
T-bill opportunity cost over 12 weeks. Each row carries a 10-step costed
farm plan with an exit rule and its two nearest priced peers. Verdicts:
14 FARM / 98 MARGINAL / 89 SKIP out of 201.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Writes `board.json`, `dashboard/data.js` and `dossier.json` to the output
directory, and copies `dashboard/` and `screenshots/` there. Deterministic:
two runs write byte-identical output.

## Layout

- `main.ts` — the entry program (Node 22, standard library only).
- `fit.json` — the fitted model: value and odds coefficients, 200
  bootstrap refits, validation numbers, ledger, farm assumptions.
- `dashboard/` — the page (index.html, app.css, app.js). It recomputes
  every implied value, farm number and verdict in the browser and checks
  them against the shipped board.
- `screenshots/` — board, detail and filtered views of the dashboard.
- `vendor/makefun-board.ts` — the kit's dossier library.
- `NOTES.md` — the model, the validation numbers and the honest limits.

---

<sub>Entered on [make.fun](https://make.fun/?ref=z3g1zh14&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
