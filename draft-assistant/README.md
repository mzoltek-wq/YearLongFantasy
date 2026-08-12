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
- Can sync from FantasyPros when `FANTASYPROS_API_KEY` is set.
- Supports CSV paste/import as a fallback for FantasyPros exports or custom rankings.

## FantasyPros Sync

The FantasyPros API can differ by sport and subscription. The sync endpoint stores any useful fields it receives and keeps the raw payload in local state, so we can adjust mappings after seeing the real responses from your API key.

Your API key stays server-side in your terminal environment and is not sent to the browser.
