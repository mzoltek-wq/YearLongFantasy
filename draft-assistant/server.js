import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3100);
const DATA_DIR = path.join(__dirname, "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const SPORTS = ["HOCKEY", "BASEBALL", "FOOTBALL", "BASKETBALL", "GOLF"];
const FANTASYPROS_BATCH_SPORTS = ["HOCKEY", "BASEBALL", "FOOTBALL", "BASKETBALL"];
const BOARDS = ["redraft", "dynasty"];
const DEFAULT_RANKING_LIMIT = 500;
const FANTASYPROS_BATCH_DELAY_MS = 1500;
const FANTASYPROS_CONSENSUS_POSITIONS = {
  HOCKEY: ["C", "LW", "RW", "D", "G"],
  BASEBALL: ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"],
  FOOTBALL: ["QB", "RB", "WR", "TE", "DST"],
  BASKETBALL: ["PG", "SG", "SF", "PF", "C"],
  GOLF: ["ALL"],
};

const defaultState = {
  players: [],
  roster: [],
  notes: {},
  watchlist: [],
  doNotDraft: [],
  crossedOff: [],
  leagueCrossedOff: [],
  settings: {
    rosterTargets: {
      HOCKEY: 17,
      BASEBALL: 22,
      FOOTBALL: 17,
      BASKETBALL: 14,
      GOLF: 5,
    },
    strategy: {
      HOCKEY: "Prioritize elite keepers and scarce top tiers.",
      BASEBALL: "Build depth steadily.",
      FOOTBALL: "Avoid overfilling too early unless value is obvious.",
      BASKETBALL: "Favor high-upside dynasty value.",
      GOLF: "Wait unless a top tier falls.",
    },
    integrations: {
      fantasyProsApiKey: "",
      leagueAppUrl: "http://localhost:3000",
      leagueAutoSync: true,
    },
  },
  syncs: [],
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/") {
      return serveFile(response, "index.html", "text/html");
    }

    if (request.method === "GET" && url.pathname === "/app.js") {
      return serveFile(response, "app.js", "text/javascript");
    }

    if (request.method === "GET" && url.pathname === "/styles.css") {
      return serveFile(response, "styles.css", "text/css");
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(response, sanitizeStateForClient(await loadState()));
    }

    if (request.method === "PUT" && url.pathname === "/api/state") {
      const payload = await readJson(request);
      const existingState = await loadState();
      const state = normalizeState({
        ...payload,
        settings: {
          ...(payload.settings ?? {}),
          integrations: {
            ...existingState.settings.integrations,
            ...(payload.settings?.integrations ?? {}),
            fantasyProsApiKey: existingState.settings.integrations.fantasyProsApiKey,
          },
        },
      });
      await saveState(state);
      return json(response, sanitizeStateForClient(state));
    }

    if (request.method === "PUT" && url.pathname === "/api/settings/fantasypros-key") {
      const payload = await readJson(request);
      const state = await loadState();
      state.settings.integrations.fantasyProsApiKey = String(payload.apiKey ?? "").trim();
      await saveState(state);
      return json(response, sanitizeStateForClient(state));
    }

    if (request.method === "DELETE" && url.pathname === "/api/settings/fantasypros-key") {
      const state = await loadState();
      state.settings.integrations.fantasyProsApiKey = "";
      await saveState(state);
      return json(response, sanitizeStateForClient(state));
    }

    if (request.method === "PUT" && url.pathname === "/api/settings/league-app-url") {
      const payload = await readJson(request);
      const state = await loadState();
      state.settings.integrations.leagueAppUrl = normalizeLeagueAppUrl(payload.leagueAppUrl);
      state.settings.integrations.leagueAutoSync = Boolean(payload.leagueAutoSync);
      await saveState(state);
      return json(response, sanitizeStateForClient(state));
    }

    if (request.method === "POST" && url.pathname === "/api/sync/league-unavailable") {
      const state = await loadState();
      const leagueAppUrl = getLeagueAppUrl(state);
      const result = await fetchLeagueUnavailablePlayers(leagueAppUrl);
      const matchedPlayerIds = getMatchingPlayerIds(state.players, result.players);
      const previousCrossedOffIds = new Set(state.crossedOff);
      const previousLeagueCrossedOffIds = new Set(state.leagueCrossedOff);
      const manualCrossedOffIds = state.crossedOff.filter((playerId) => !previousLeagueCrossedOffIds.has(playerId));
      state.leagueCrossedOff = matchedPlayerIds;
      state.crossedOff = Array.from(new Set([...manualCrossedOffIds, ...matchedPlayerIds]));
      const newCrossedOffCount = matchedPlayerIds.filter((playerId) => !previousCrossedOffIds.has(playerId)).length;
      state.syncs.unshift({
        source: "League app",
        sport: "ALL",
        boardType: "all",
        imported: matchedPlayerIds.length,
        unavailablePlayers: result.players.length,
        newlyCrossedOff: newCrossedOffCount,
        unmatched: getUnmatchedLeaguePlayers(state.players, result.players).slice(0, 30),
        leagueAppUrl,
        at: new Date().toISOString(),
      });
      await saveState(state);
      return json(response, {
        unavailablePlayers: result.players.length,
        matchedPlayers: matchedPlayerIds.length,
        newlyCrossedOff: newCrossedOffCount,
        unmatchedPlayers: getUnmatchedLeaguePlayers(state.players, result.players),
        state: sanitizeStateForClient(state),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/debug/fantasypros") {
      const payload = await readJson(request);
      const state = await loadState();
      const sport = normalizeSport(payload.sport);
      const boardType = normalizeBoardType(payload.boardType);
      const season = Number(payload.season ?? new Date().getFullYear());
      const position = String(payload.position ?? "ALL").toUpperCase();
      const diagnostics = await runFantasyProsDiagnostics({ state, sport, boardType, season, position });
      return json(response, diagnostics);
    }

    if (request.method === "POST" && url.pathname === "/api/import/csv") {
      const payload = await readJson(request);
      const state = await loadState();
      const importedPlayers = parseCsvPlayers({
        text: String(payload.text ?? ""),
        sport: normalizeSport(payload.sport),
        boardType: normalizeBoardType(payload.boardType),
        source: String(payload.source ?? "CSV").trim() || "CSV",
      });
      state.players = mergePlayers(state.players, importedPlayers);
      state.syncs.unshift({
        source: payload.source ?? "CSV",
        sport: normalizeSport(payload.sport),
        boardType: normalizeBoardType(payload.boardType),
        imported: importedPlayers.length,
        at: new Date().toISOString(),
      });
      await saveState(state);
      return json(response, { imported: importedPlayers.length, state: sanitizeStateForClient(state) });
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/manual") {
      const payload = await readJson(request);
      const state = await loadState();
      const player = createPlayerRecord({
        displayName: String(payload.playerName ?? "").trim(),
        sport: normalizeSport(payload.sport),
        boardType: normalizeBoardType(payload.boardType),
        source: "Manual Watchlist",
        rank: 9999,
        position: String(payload.position ?? "").trim(),
        team: String(payload.team ?? "").trim(),
        tier: null,
        injuryStatus: String(payload.injuryStatus ?? "").trim(),
        upsideNote: String(payload.note ?? "").trim(),
        raw: {
          addedManually: true,
          note: String(payload.note ?? "").trim(),
        },
      });

      if (!player.displayName) {
        throw new Error("Player name is required.");
      }

      state.players = mergePlayers(state.players, [player]);
      if (!state.watchlist.includes(player.id)) {
        state.watchlist.push(player.id);
      }
      if (payload.note) {
        state.notes[player.id] = String(payload.note).trim();
      }

      await saveState(state);
      return json(response, { player, state: sanitizeStateForClient(state) });
    }

    if (request.method === "POST" && url.pathname === "/api/sync/fantasypros") {
      const payload = await readJson(request);
      const sport = normalizeSport(payload.sport);
      const boardType = normalizeBoardType(payload.boardType);
      const season = Number(payload.season ?? new Date().getFullYear());
      const position = String(payload.position ?? "ALL").toUpperCase();
      const limit = Number(payload.limit ?? DEFAULT_RANKING_LIMIT);
      const state = await loadState();
      const result = await fetchFantasyProsRankings({ sport, boardType, season, position, limit, apiKey: getFantasyProsApiKey(state) });
      state.players = mergePlayers(state.players, result.players);
      state.syncs.unshift({
        source: "FantasyPros",
        sport,
        boardType,
        imported: result.players.length,
        endpoint: result.endpoint,
        at: new Date().toISOString(),
      });
      await saveState(state);
      return json(response, { imported: result.players.length, endpoint: result.endpoint, state: sanitizeStateForClient(state) });
    }

    if (request.method === "POST" && url.pathname === "/api/sync/fantasypros/all") {
      const payload = await readJson(request);
      const season = Number(payload.season ?? new Date().getFullYear());
      const position = String(payload.position ?? "ALL").toUpperCase();
      const limit = Number(payload.limit ?? DEFAULT_RANKING_LIMIT);
      const state = await loadState();
      const results = [];
      const failures = [];
      let hitFantasyProsLimit = false;

      for (const sport of FANTASYPROS_BATCH_SPORTS) {
        for (const boardType of BOARDS) {
          for (const requestPosition of getFantasyProsConsensusPositions(sport, position)) {
            if (hitFantasyProsLimit) {
              failures.push({
                sport,
                boardType,
                position: requestPosition,
                error: "Skipped because FantasyPros returned Limit Exceeded earlier in this batch.",
                skipped: true,
              });
              continue;
            }

            await delay(FANTASYPROS_BATCH_DELAY_MS);
            try {
              const result = await fetchFantasyProsRankings({
                sport,
                boardType,
                season,
                position: requestPosition,
                limit,
                apiKey: getFantasyProsApiKey(state),
              });
              state.players = mergePlayers(state.players, result.players);
              results.push({
                sport,
                boardType,
                position: requestPosition,
                imported: result.players.length,
                endpoint: result.endpoint,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Sync failed.";
              failures.push({
                sport,
                boardType,
                position: requestPosition,
                error: message,
              });
              if (isFantasyProsLimitError(message)) {
                hitFantasyProsLimit = true;
              }
            }
          }
        }
      }

      state.syncs.unshift({
        source: "FantasyPros batch",
        sport: "ALL",
        boardType: "all",
        imported: results.reduce((total, result) => total + result.imported, 0),
        requestCount: results.length + failures.length,
        limit,
        hitFantasyProsLimit,
        results,
        failures,
        at: new Date().toISOString(),
      });

      await saveState(state);
      return json(response, { results, failures, state: sanitizeStateForClient(state) });
    }

    json(response, { error: "Not found" }, 404);
  } catch (error) {
    json(response, { error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Private draft assistant running at http://localhost:${PORT}`);
});

async function serveFile(response, filename, contentType) {
  const file = await readFile(path.join(PUBLIC_DIR, filename), "utf8");
  response.writeHead(200, { "Content-Type": contentType });
  response.end(file);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });

  if (!existsSync(STATE_PATH)) {
    await saveState(defaultState);
    return structuredClone(defaultState);
  }

  const state = JSON.parse(await readFile(STATE_PATH, "utf8"));
  return normalizeState(state);
}

async function saveState(state) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(normalizeState(state), null, 2)}\n`);
}

function normalizeState(state) {
  return {
    ...defaultState,
    ...state,
    players: Array.isArray(state?.players) ? state.players.map(normalizePlayerRecord) : [],
    roster: Array.isArray(state?.roster) ? state.roster : [],
    notes: state?.notes && typeof state.notes === "object" ? state.notes : {},
    watchlist: Array.isArray(state?.watchlist) ? state.watchlist : [],
    doNotDraft: Array.isArray(state?.doNotDraft) ? state.doNotDraft : [],
    crossedOff: Array.isArray(state?.crossedOff) ? state.crossedOff : [],
    leagueCrossedOff: Array.isArray(state?.leagueCrossedOff) ? state.leagueCrossedOff : [],
    syncs: Array.isArray(state?.syncs) ? state.syncs : [],
    settings: {
      ...defaultState.settings,
      ...(state?.settings ?? {}),
      rosterTargets: {
        ...defaultState.settings.rosterTargets,
        ...(state?.settings?.rosterTargets ?? {}),
      },
      strategy: {
        ...defaultState.settings.strategy,
        ...(state?.settings?.strategy ?? {}),
      },
      integrations: {
        ...defaultState.settings.integrations,
        ...(state?.settings?.integrations ?? {}),
      },
    },
  };
}

function sanitizeStateForClient(state) {
  const normalizedState = normalizeState(state);
  const hasFantasyProsKey = Boolean(normalizedState.settings.integrations.fantasyProsApiKey);
  return {
    ...normalizedState,
    settings: {
      ...normalizedState.settings,
      integrations: {
        ...normalizedState.settings.integrations,
        fantasyProsApiKey: "",
        hasFantasyProsApiKey: hasFantasyProsKey,
      },
    },
  };
}

function getFantasyProsApiKey(state) {
  return state.settings.integrations.fantasyProsApiKey || process.env.FANTASYPROS_API_KEY || "";
}

function getLeagueAppUrl(state) {
  return state.settings.integrations.leagueAppUrl || process.env.LEAGUE_APP_URL || "http://localhost:3000";
}

function normalizeLeagueAppUrl(value) {
  const url = String(value ?? "").trim() || "http://localhost:3000";
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Enter a valid league app URL, like http://localhost:3000.");
  }
}

function getFantasyProsApiKeyOptions(state) {
  const options = [];
  if (state.settings.integrations.fantasyProsApiKey) {
    options.push({
      source: "local",
      apiKey: state.settings.integrations.fantasyProsApiKey,
      keyLength: state.settings.integrations.fantasyProsApiKey.length,
    });
  }
  if (process.env.FANTASYPROS_API_KEY && process.env.FANTASYPROS_API_KEY !== state.settings.integrations.fantasyProsApiKey) {
    options.push({
      source: "env",
      apiKey: process.env.FANTASYPROS_API_KEY,
      keyLength: process.env.FANTASYPROS_API_KEY.length,
    });
  }
  return options;
}

function normalizePlayerRecord(player) {
  if (!player || typeof player !== "object") {
    return player;
  }

  const sport = normalizeSport(player.sport);
  const position = String(player.position ?? derivePosition(player.raw) ?? "").trim() || null;
  return {
    ...player,
    sport,
    boardType: normalizeBoardType(player.boardType),
    position,
    team: player.team ?? deriveTeam(player.raw),
    positionGroup: player.positionGroup ?? normalizePositionGroup(sport, position),
  };
}

function json(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function normalizeSport(value) {
  const sport = String(value ?? "").toUpperCase();
  if (!SPORTS.includes(sport)) {
    throw new Error(`Unknown sport "${value}".`);
  }
  return sport;
}

function normalizeBoardType(value) {
  const boardType = String(value ?? "redraft").toLowerCase();
  if (!BOARDS.includes(boardType)) {
    throw new Error(`Unknown board type "${value}".`);
  }
  return boardType;
}

function parseCsvPlayers({ text, sport, boardType, source }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const firstCells = splitCsvLine(lines[0]).map(normalizeHeader);
  const hasHeader = firstCells.some((cell) => ["player", "playername", "name"].includes(cell));
  const headers = hasHeader ? firstCells : [];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line, index) => {
      const cells = splitCsvLine(line);
      const get = (...names) => {
        for (const name of names) {
          const headerIndex = headers.indexOf(normalizeHeader(name));
          if (headerIndex !== -1) {
            return cells[headerIndex];
          }
        }
        return undefined;
      };
      const rank = Number(get("rank", "overall", "overall rank") ?? cells[0] ?? index + 1);
      const displayName = String(get("player", "player name", "name") ?? cells[hasHeader ? 0 : 1] ?? cells[0] ?? "").trim();

      if (!displayName) {
        return null;
      }

      return createPlayerRecord({
        displayName,
        sport,
        boardType,
        source,
        rank: Number.isFinite(rank) ? rank : index + 1,
        position: String(get("position", "pos") ?? "").trim(),
        team: String(get("team", "tm") ?? "").trim(),
        tier: toNullableNumber(get("tier")),
        injuryStatus: String(get("injury", "injury status", "status") ?? "").trim(),
        upsideNote: String(get("note", "notes", "outlook") ?? "").trim(),
        raw: { line, cells, headers },
      });
    })
    .filter(Boolean);
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createPlayerRecord(input) {
  const normalizedName = normalizeName(input.displayName);
  const position = String(input.position ?? derivePosition(input.raw) ?? "").trim();
  const team = String(input.team ?? deriveTeam(input.raw) ?? "").trim();
  return {
    id: `${input.sport}:${input.boardType}:${normalizedName}`,
    normalizedName,
    displayName: input.displayName,
    sport: input.sport,
    boardType: input.boardType,
    source: input.source,
    rank: input.rank,
    position: position || null,
    positionGroup: normalizePositionGroup(input.sport, position),
    team: team || null,
    tier: input.tier ?? null,
    injuryStatus: input.injuryStatus || null,
    upsideNote: input.upsideNote || null,
    raw: input.raw ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergePlayers(existingPlayers, incomingPlayers) {
  const byKey = new Map(existingPlayers.map((player) => [`${player.sport}:${player.boardType}:${player.normalizedName}:${player.source}`, player]));

  for (const player of incomingPlayers) {
    byKey.set(`${player.sport}:${player.boardType}:${player.normalizedName}:${player.source}`, {
      ...(byKey.get(`${player.sport}:${player.boardType}:${player.normalizedName}:${player.source}`) ?? {}),
      ...player,
    });
  }

  return Array.from(byKey.values()).sort((left, right) => (left.rank ?? 9999) - (right.rank ?? 9999));
}

async function fetchLeagueUnavailablePlayers(leagueAppUrl) {
  const endpoint = `${leagueAppUrl.replace(/\/$/, "")}/api/assistant/unavailable`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`League app unavailable sync failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  return {
    ...payload,
    players: Array.isArray(payload.players) ? payload.players.map(normalizeLeagueUnavailablePlayer).filter((player) => player.normalizedName) : [],
  };
}

function normalizeLeagueUnavailablePlayer(player) {
  return {
    displayName: String(player?.displayName ?? player?.playerName ?? "").trim(),
    normalizedName: normalizeName(player?.normalizedName ?? player?.displayName ?? player?.playerName ?? ""),
    sport: player?.sport ?? null,
    managerName: player?.managerName ?? player?.ownerName ?? null,
    source: player?.source ?? null,
  };
}

function getMatchingPlayerIds(rankingPlayers, leaguePlayers) {
  const leagueNames = new Set(leaguePlayers.map((player) => player.normalizedName).filter(Boolean));
  return rankingPlayers.filter((player) => leagueNames.has(player.normalizedName)).map((player) => player.id);
}

function getUnmatchedLeaguePlayers(rankingPlayers, leaguePlayers) {
  const rankingNames = new Set(rankingPlayers.map((player) => player.normalizedName));
  return leaguePlayers
    .filter((player) => !rankingNames.has(player.normalizedName))
    .map((player) => ({
      displayName: player.displayName,
      sport: player.sport,
      managerName: player.managerName,
      source: player.source,
    }));
}

function normalizePositionGroup(sport, position) {
  const value = String(position ?? "").toUpperCase();
  const firstPosition = value.split(",").map((entry) => entry.trim()).find(Boolean) ?? "";

  if (sport === "HOCKEY") {
    if (["C", "LW", "RW", "W", "F"].includes(firstPosition)) {
      return "F";
    }
    if (["D", "DEF"].includes(firstPosition)) {
      return "D";
    }
    if (["G", "GK"].includes(firstPosition)) {
      return "G";
    }
  }

  if (sport === "BASKETBALL") {
    if (["PG", "SG", "G"].includes(firstPosition)) {
      return "G";
    }
    if (["SF", "PF", "F"].includes(firstPosition)) {
      return "F";
    }
    if (firstPosition === "C") {
      return "C";
    }
  }

  if (sport === "FOOTBALL") {
    if (["QB", "RB", "WR", "TE", "DST", "DEF"].includes(firstPosition)) {
      return firstPosition === "DST" ? "DEF" : firstPosition;
    }
  }

  if (sport === "BASEBALL") {
    if (["LF", "CF", "RF"].includes(firstPosition)) {
      return "OF";
    }
    if (["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"].includes(firstPosition)) {
      return firstPosition;
    }
    if (firstPosition === "DH") {
      return "1B";
    }
  }

  return firstPosition || null;
}

function derivePosition(raw) {
  return (
    raw?.position ??
    raw?.pos ??
    raw?.player_position_id ??
    raw?.primary_position ??
    raw?.position_id ??
    raw?.player_positions ??
    raw?.player_eligibility ??
    raw?.player_espn_positions ??
    raw?.player_yahoo_positions ??
    raw?.player_cbs_positions ??
    ""
  );
}

function deriveTeam(raw) {
  return raw?.team ?? raw?.team_abbr ?? raw?.teamAbbr ?? raw?.player_team_id ?? "";
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isFantasyProsLimitError(message) {
  return /limit exceeded|too many requests|429/i.test(String(message ?? ""));
}

function getFantasyProsConsensusPositions(sport, requestedPosition) {
  if (requestedPosition !== "ALL") {
    return [requestedPosition];
  }

  return FANTASYPROS_CONSENSUS_POSITIONS[sport] ?? ["ALL"];
}

async function fetchFantasyProsRankings({ sport, boardType, season, position, limit = DEFAULT_RANKING_LIMIT, apiKey }) {
  if (!apiKey) {
    throw new Error("Save a FantasyPros API key in the assistant settings or set FANTASYPROS_API_KEY before syncing rankings.");
  }

  return fetchFantasyProsConsensusRankings({ apiKey, sport, boardType, season, position });
}

async function fetchFantasyProsConsensusRankings({ apiKey, sport, boardType, season, position }) {
  const sportPath = getFantasyProsSportPath(sport);
  const rankingType = boardType === "dynasty" ? "dynasty" : "draft";
  const params = new URLSearchParams({
    position,
    type: rankingType,
  });
  if (sport === "FOOTBALL") {
    params.set("scoring", "HALF");
  }
  removeBlankSearchParams(params);
  const endpoint = `https://api.fantasypros.com/public/v2/json/${sportPath}/${season}/consensus-rankings?${params.toString()}`;
  return fetchFantasyProsEndpoint({ endpoint, apiKey, sport, boardType, source: "FantasyPros Consensus" });
}

async function fetchFantasyProsEndpoint({ endpoint, apiKey, sport, boardType, source }) {
  const response = await fetch(endpoint, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${source} failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  const records = findRankingRecords(payload);
  const players = records.map((record, index) =>
    createPlayerRecord({
      displayName: derivePlayerName(record),
      sport,
      boardType,
      source,
      rank: Number(record.rank ?? record.overall_rank ?? record.overallRank ?? record.ecr ?? record.rank_ecr ?? record.rank_ave ?? record.player_rank ?? record.pos_rank?.replace?.(/^[A-Z]+/i, "") ?? index + 1),
      position: String(derivePosition(record)),
      team: String(deriveTeam(record)),
      tier: toNullableNumber(record.tier),
      injuryStatus: String(record.injury_status ?? record.injuryStatus ?? record.status ?? ""),
      upsideNote: String(record.notes ?? record.outlook ?? ""),
      raw: record,
    }),
  );

  return {
    endpoint,
    players: players.filter((player) => player.displayName),
  };
}

async function runFantasyProsDiagnostics({ state, sport, boardType, season, position }) {
  const keyOptions = getFantasyProsApiKeyOptions(state);
  if (keyOptions.length === 0) {
    return {
      ok: false,
      message: "No FantasyPros key is saved locally or set in FANTASYPROS_API_KEY.",
      tests: [],
    };
  }

  const sportPath = getFantasyProsSportPath(sport);
  const rankingType = boardType === "dynasty" ? "dynasty" : "draft";
  const endpointTests = [
    {
      name: "consensus-documented",
      url: `https://api.fantasypros.com/public/v2/json/${sportPath}/${season}/consensus-rankings?type=${encodeURIComponent(rankingType)}&position=${encodeURIComponent(position)}`,
    },
    {
      name: "consensus-documented-scoring",
      url: `https://api.fantasypros.com/public/v2/json/${sportPath}/${season}/consensus-rankings?type=${encodeURIComponent(rankingType)}&position=${encodeURIComponent(position)}&scoring=HALF`,
    },
    {
      name: "consensus-consensus-type",
      url: `https://api.fantasypros.com/public/v2/json/${sportPath}/${season}/consensus-rankings?type=consensus&position=${encodeURIComponent(position)}`,
    },
  ];
  const authStyles = [
    {
      name: "x-api-key",
      headers: (apiKey) => ({ "x-api-key": apiKey, Accept: "application/json" }),
    },
    {
      name: "authorization-bearer",
      headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}`, Accept: "application/json" }),
    },
    {
      name: "subscription-key",
      headers: (apiKey) => ({ "Ocp-Apim-Subscription-Key": apiKey, Accept: "application/json" }),
    },
  ];
  const tests = [];

  for (const keyOption of keyOptions) {
    for (const endpointTest of endpointTests) {
      for (const authStyle of authStyles) {
        const startedAt = Date.now();
        try {
          const response = await fetch(endpointTest.url, {
            headers: authStyle.headers(keyOption.apiKey),
          });
          const body = await response.text();
          tests.push({
            keySource: keyOption.source,
            keyLength: keyOption.keyLength,
            endpoint: endpointTest.name,
            auth: authStyle.name,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
            bodySnippet: body.slice(0, 220),
          });
        } catch (error) {
          tests.push({
            keySource: keyOption.source,
            keyLength: keyOption.keyLength,
            endpoint: endpointTest.name,
            auth: authStyle.name,
            status: null,
            ok: false,
            durationMs: Date.now() - startedAt,
            bodySnippet: error instanceof Error ? error.message : "Request failed.",
          });
        }
      }
    }
  }

  return {
    ok: tests.some((test) => test.ok),
    tests,
  };
}

function derivePlayerName(record) {
  return (
    record.player_name ??
    record.playerName ??
    record.player?.player_name ??
    record.player?.name ??
    record.player?.full_name ??
    record.name ??
    record.full_name ??
    record.fullName ??
    ""
  );
}

function getFantasyProsSportPath(sport) {
  return {
    FOOTBALL: "nfl",
    BASEBALL: "mlb",
    BASKETBALL: "nba",
    HOCKEY: "nhl",
    GOLF: "pga",
  }[sport];
}

function removeBlankSearchParams(params) {
  for (const [key, value] of params.entries()) {
    if (!value) {
      params.delete(key);
    }
  }
}

function findRankingRecords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidates = ["rankings", "players", "data", "results"];
  for (const key of candidates) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  for (const value of Object.values(payload ?? {})) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      const nested = findRankingRecords(value);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}
