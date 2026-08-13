# Private Draft Assistant

Local-only draft assistant for private rankings, notes, watchlists, and crossed-off players.

## Run

```bash
cd draft-assistant
FANTASYPROS_API_KEY="your-key" npm run dev
```

Then open:

```text
http://localhost:3100
```

## What It Does

- Keeps private state in `draft-assistant/data/state.json`.
- Lets you cross off drafted/kept players.
- Tracks your roster by sport.
- Supports tabs for Hockey, Baseball, Football, Basketball, and Golf.
- Supports `redraft` and `dynasty` ranking boards.
- Supports manual watchlist names that are not in rankings yet, such as golfers, prospects, overseas players, or rumor-based stashes.
- Can sync from FantasyPros when `FANTASYPROS_API_KEY` is set.
- Can run a one-time FantasyPros batch sync for Hockey, Baseball, Basketball, and Football.
- Tries FantasyPros imports in this order: broad rankings, consensus rankings, then player pool with ECR metadata.
- Golf is intentionally skipped in FantasyPros batch sync for now; use manual watchlist or a future OWGR import.
- Normalizes positions into draft-useful groups: Hockey F/D/G, Baseball C/1B/2B/3B/SS/OF/SP/RP, Football QB/RB/WR/TE/DEF, and Basketball G/F/C.
- Supports CSV paste/import as a fallback for FantasyPros exports or custom rankings.

## FantasyPros Sync

The FantasyPros API can differ by sport and subscription. The sync endpoint stores any useful fields it receives and keeps the raw payload in local state, so we can adjust mappings after seeing the real responses from your API key.

Your API key stays server-side in your terminal environment and is not sent to the browser.

The sport and board tabs show player counts after sync. If a tab says `0`, that board did not return usable players from the latest import.

Batch sync asks for larger lists and falls back when a route is unavailable for the API key. If every API route still returns a small result set, use FantasyPros CSV exports or copied ranking tables with the CSV importer to load deeper lists without spending API requests.
