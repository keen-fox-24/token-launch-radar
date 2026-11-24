# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/keen-fox-24/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/keen-fox-24/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's **token-radar-01** bounty ("Build the best token launch radar"),
by @keen-fox-24.

The program reads the competition's sealed snapshot of every protocol DefiLlama tracks,
finds the ones that record no token yet, and ranks them by an **implied launch value**:

    implied value = TVL x live peer multiple x growth x maturity x chain breadth

- **Live peer multiple** — the median market-cap / TVL of same-category protocols whose
  token already trades, computed from the snapshot itself (categories with fewer than
  three live peers fall back to the global live median).
- **Growth** — the 7-day TVL change, clamped so one hot week cannot dominate.
- **Maturity** — years tracked with no token: a longer tokenless record earns more.
- **Chain breadth** — a small bonus per extra chain.
- Below the watchlist floor, wrapped / staked / bridged products of tokens that already
  trade, and exchange balance sheets, are set aside entirely — the same judgement the
  house's watchlist rule makes.

Every board row carries a concrete farm plan (action, cost, duration) generated for its
category and chains. The dashboard (`dashboard/`) is a static page that renders with no
network: a sortable, filterable board, a detail view per protocol with the model's
factor breakdown, and the live-anchor table the values are read from.

## Run

Node.js 22.18 or later, standard library only:

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the
output directory. The build is deterministic: two runs write identical bytes.

## Layout

- `main.ts` — entry point: snapshot in, deliverables out.
- `lib/model.ts` — the radar-2 valuation model, farm-plan generator and board validator.
- `vendor/makefun-board.ts` — the competition kit's dossier library, vendored unchanged.
- `dashboard/` — the static page (index.html, app.css, app.js).
- `screenshots/` — the board, a detail view and a filtered view, rendered from the page.

MIT licensed — see `LICENSE`.
