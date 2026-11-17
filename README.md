# token-radar-4k

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tianyc1028/token-radar-4k/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tianyc1028/token-radar-4k/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of 758 DeFi protocols, ranks every
pre-token protocol by an implied value, and gives each one a concrete farm plan.
The board covers all 40 watchlist protocols and 158 more pre-token protocols below
the floor, 198 rows in all. Implied value follows from the snapshot's own figures —
TVL, seven-day growth and how long the protocol has run with no token — under the
radar-2 model, and no protocol name is ever special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22 or later, standard library only, no network. It writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output
directory. Open `dashboard/index.html` in a browser to use the board: search,
filter by category, sort, switch between the pre-token board and the live-token
view, and open any row for its model breakdown and farm plan.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
