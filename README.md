# Token Launch Radar

A token launch radar: it reads a sealed snapshot of DeFi protocols, ranks the
pre-token ones by an implied value the model derives from each protocol's own
figures (TVL, seven-day growth, how long it has run with no token), and shows
a reader how to farm each one.

- `main.ts` — the program. Reads `/input/snapshot.json`, scores every
  protocol with the model in `lib/model.ts`, writes the ranked board to
  `/output/board.json`, writes the dashboard's data, copies `dashboard/` and
  `screenshots/` to `/output`, and writes `/output/dossier.json`.
- `lib/model.ts` — the scoring model and the board builder.
- `dashboard/` — the static page: a ranked board, a detail view per protocol,
  and a filter. No network, no framework.
- `screenshots/` — three views of the dashboard: the board, a protocol's
  detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as
  the kit ships it.

The board holds 226 rows covering all 40 protocols on the snapshot's
watchlist, plus the early protocols below the floor. Run it with:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

## How the model scores

The model is version `radar-2`, and it scores every protocol with the same
function — no protocol name is ever special-cased. A protocol counts as
pre-token when the snapshot records no token for it: no market cap, no
CoinGecko id, no symbol. Protocols whose token already trades are kept
apart in a Live view that shows the market's own value, never mixed into
the ranked board.

The implied value follows only from the snapshot's own figures:

- It starts from the protocol's TVL, times a base multiple.
- Seven-day TVL growth moves it up or down, clamped to a sane band;
  a protocol with no reported growth takes a small discount instead.
- Maturity counts: the longer a protocol has run with no token, up to
  three years, the higher it scores.
- Spreading across more chains adds a little; a protocol on one chain
  gets no bonus for it.
- The protocol's size is compared with the median TVL of its category,
  so a big fish in a small category scores above a middling one in a
  crowded category.

The board carries the 40 watchlist protocols and the 186 early ones
below the floor with the most TVL, ranked by that implied value, most
valuable first. Every row carries a farm plan: concrete steps with what
they cost and how long they take, written for that protocol, not slogans.

## The dashboard

The page is a static site with no network and no framework. It shows
the ranked board, a detail view for each protocol, a filter, and the
Live view of tokens that already trade. The model sandbox on the page
lets a reader change the model's constants and see the board re-rank.
The three screenshots in `screenshots/` show the board, a protocol's
detail view, and a filtered view, all rendered from this dashboard.
