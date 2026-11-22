# Launch Radar v2 — token-radar-01

A token launch radar for make.fun's token-radar-01 bounty. It ranks the
snapshot's pre-token protocols by implied value, shows how to farm each
one, and proves every claim on the cover with out-of-sample numbers.

**The model.** The value of a token that does not exist yet is fitted, not
guessed: ln(mcap/TVL) is regressed on ln(TVL) over the 113 listed comps,
so bigger TVL means a smaller multiple (slope -0.404). Implied value is
the if-listing value times the token odds (a logistic model on age, size,
growth and family). Each term was tested leave-one-out AND walk-forward;
only the size curve survived both. The cover prints the miss numbers, the
honesty check, the Brier score and the blind-holdout result.

**Farm verdicts.** Every row gets FARM / MARGINAL / SKIP from a net computed
after fees: a sized deposit, an airdrop share, fee income, gas and the
T-bill opportunity cost over 12 weeks. Each row carries a 10-step costed
farm plan with an exit rule and its two nearest priced peers.

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
