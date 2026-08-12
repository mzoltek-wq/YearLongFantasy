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
const BOARDS = ["redraft", "dynasty"];

const defaultState = {
  players: [],
  roster: [],
  notes: {},
  watchlist: [],
  doNotDraft: [],
  crossedOff: [],
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
      return json(response, await loadState());
    }

    if (request.method === "PUT" && url.pathname === "/api/state") {
      const payload = await readJson(request);
      const state = normalizeState(payload);
      await saveState(state);
      return json(response, state);
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
      return json(response, { imported: importedPlayers.length, state });
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
      return json(response, { player, state });
    }

    if (request.method === "POST" && url.pathname === "/api/sync/fantasypros") {
      const payload = await readJson(request);
      const sport = normalizeSport(payload.sport);
      const boardType = normalizeBoardType(payload.boardType);
      const season = Number(payload.season ?? new Date().getFullYear());
      const position = String(payload.position ?? "ALL").toUpperCase();
      const result = await fetchFantasyProsRankings({ sport, boardType, season, position });
      const state = await loadState();
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
      return json(response, { imported: result.players.length, endpoint: result.endpoint, state });
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
    players: Array.isArray(state?.players) ? state.players : [],
    roster: Array.isArray(state?.roster) ? state.roster : [],
    notes: state?.notes && typeof state.notes === "object" ? state.notes : {},
    watchlist: Array.isArray(state?.watchlist) ? state.watchlist : [],
    doNotDraft: Array.isArray(state?.doNotDraft) ? state.doNotDraft : [],
    crossedOff: Array.isArray(state?.crossedOff) ? state.crossedOff : [],
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
    },
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
  return {
    id: `${input.sport}:${input.boardType}:${normalizedName}`,
    normalizedName,
    displayName: input.displayName,
    sport: input.sport,
    boardType: input.boardType,
    source: input.source,
    rank: input.rank,
    position: input.position || null,
    team: input.team || null,
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

async function fetchFantasyProsRankings({ sport, boardType, season, position }) {
  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) {
    throw new Error("Set FANTASYPROS_API_KEY before syncing FantasyPros rankings.");
  }

  const sportPath = {
    FOOTBALL: "nfl",
    BASEBALL: "mlb",
    BASKETBALL: "nba",
    HOCKEY: "nhl",
    GOLF: "pga",
  }[sport];
  const rankingType = boardType === "dynasty" ? "dynasty" : "consensus";
  const endpoint = `https://api.fantasypros.com/public/v2/json/${sportPath}/${season}/consensus-rankings?type=${encodeURIComponent(rankingType)}&position=${encodeURIComponent(position)}`;
  const response = await fetch(endpoint, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`FantasyPros sync failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  const records = findRankingRecords(payload);
  const players = records.map((record, index) =>
    createPlayerRecord({
      displayName: record.player_name ?? record.playerName ?? record.name ?? record.full_name ?? record.fullName ?? "",
      sport,
      boardType,
      source: "FantasyPros",
      rank: Number(record.rank ?? record.overall_rank ?? record.ecr ?? index + 1),
      position: String(record.position ?? record.pos ?? ""),
      team: String(record.team ?? record.team_abbr ?? record.teamAbbr ?? ""),
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
