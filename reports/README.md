# Reports

Two Claude artifacts are kept in sync with the game. Update both whenever a servant
is added or rebalanced.

| Artifact | Slug | Built from |
| --- | --- | --- |
| Fate/Duel — Servant Win Rates (Data dashboard) | `65674f8c-75b6-4b67-9224-c3b5670b66b4` | `winrates.csv`, `matchups.csv`, `run.csv` |
| Fate/Duel Roster (page) | `b0f3651a-a4b2-4cda-8780-0d1817163bc9` | `roster.html` |

## Update steps
1. `node tools/simulate.js 2000 1 --out reports` (writes the three CSVs)
2. `node tools/roster-page.js` (writes roster.html)
3. Win rates: upload the three CSVs to the dashboard as new assets, then update the
   `url` in `datasets/winrates`, `datasets/matchups`, `datasets/run` and their `updated`/`edit` stamps.
4. Roster: republish `roster.html` as the roster artifact's `index.html`.
