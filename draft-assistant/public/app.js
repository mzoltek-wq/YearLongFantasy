const SPORTS = [
  ["HOCKEY", "Hockey"],
  ["BASEBALL", "Baseball"],
  ["FOOTBALL", "Football"],
  ["BASKETBALL", "Basketball"],
  ["GOLF", "Golf"],
];
const BOARDS = [
  ["redraft", "Year to year"],
  ["dynasty", "Dynasty"],
];
const POSITION_GROUPS = {
  HOCKEY: [
    ["ALL", "All"],
    ["F", "Forwards"],
    ["D", "Defense"],
    ["G", "Goalies"],
  ],
  BASEBALL: [
    ["ALL", "All"],
    ["C", "C"],
    ["1B", "1B"],
    ["2B", "2B"],
    ["3B", "3B"],
    ["SS", "SS"],
    ["OF", "OF"],
    ["SP", "SP"],
    ["RP", "RP"],
  ],
  FOOTBALL: [
    ["ALL", "All"],
    ["QB", "QB"],
    ["RB", "RB"],
    ["WR", "WR"],
    ["TE", "TE"],
    ["DEF", "DEF"],
  ],
  BASKETBALL: [
    ["ALL", "All"],
    ["G", "Guards"],
    ["F", "Forwards"],
    ["C", "Centers"],
  ],
  GOLF: [["ALL", "All"]],
};

let state = null;
let currentSport = "HOCKEY";
let currentBoard = "redraft";
let currentPositionGroup = "ALL";
let hideCrossedOff = true;

const elements = {
  sportTabs: document.querySelector("#sportTabs"),
  boardTabs: document.querySelector("#boardTabs"),
  positionTabs: document.querySelector("#positionTabs"),
  searchInput: document.querySelector("#searchInput"),
  playerList: document.querySelector("#playerList"),
  playerTemplate: document.querySelector("#playerTemplate"),
  boardTitle: document.querySelector("#boardTitle"),
  rosterNeeds: document.querySelector("#rosterNeeds"),
  strategyInput: document.querySelector("#strategyInput"),
  csvInput: document.querySelector("#csvInput"),
  csvSourceInput: document.querySelector("#csvSourceInput"),
  fantasyProsApiKeyInput: document.querySelector("#fantasyProsApiKeyInput"),
  fantasyProsKeyStatus: document.querySelector("#fantasyProsKeyStatus"),
  saveFantasyProsKeyButton: document.querySelector("#saveFantasyProsKeyButton"),
  importCsvButton: document.querySelector("#importCsvButton"),
  syncFantasyProsButton: document.querySelector("#syncFantasyProsButton"),
  debugFantasyProsButton: document.querySelector("#debugFantasyProsButton"),
  syncAllFantasyProsButton: document.querySelector("#syncAllFantasyProsButton"),
  manualWatchNameInput: document.querySelector("#manualWatchNameInput"),
  manualWatchPositionInput: document.querySelector("#manualWatchPositionInput"),
  manualWatchTeamInput: document.querySelector("#manualWatchTeamInput"),
  manualWatchNoteInput: document.querySelector("#manualWatchNoteInput"),
  addManualWatchButton: document.querySelector("#addManualWatchButton"),
  hideCrossedOffInput: document.querySelector("#hideCrossedOffInput"),
  myRoster: document.querySelector("#myRoster"),
  injuryUpside: document.querySelector("#injuryUpside"),
  recentSyncs: document.querySelector("#recentSyncs"),
  saveStateButton: document.querySelector("#saveStateButton"),
  refreshButton: document.querySelector("#refreshButton"),
  availableCount: document.querySelector("#availableCount"),
  crossedOffCount: document.querySelector("#crossedOffCount"),
  watchlistCount: document.querySelector("#watchlistCount"),
  rosterCount: document.querySelector("#rosterCount"),
};

boot();

async function boot() {
  renderTabs();
  await loadState();
  bindEvents();
  render();
}

async function loadState() {
  state = await requestJson("/api/state");
  state.players = state.players.map(normalizePlayerForClient);
}

function bindEvents() {
  elements.searchInput.addEventListener("input", render);
  elements.hideCrossedOffInput.addEventListener("change", () => {
    hideCrossedOff = elements.hideCrossedOffInput.checked;
    render();
  });
  elements.strategyInput.addEventListener("change", () => {
    state.settings.strategy[currentSport] = elements.strategyInput.value;
    saveState();
  });
  elements.saveStateButton.addEventListener("click", saveState);
  elements.refreshButton.addEventListener("click", async () => {
    await loadState();
    render();
  });
  elements.importCsvButton.addEventListener("click", importCsv);
  elements.saveFantasyProsKeyButton.addEventListener("click", saveFantasyProsKey);
  elements.syncFantasyProsButton.addEventListener("click", syncFantasyPros);
  elements.debugFantasyProsButton.addEventListener("click", debugFantasyPros);
  elements.syncAllFantasyProsButton.addEventListener("click", syncAllFantasyPros);
  elements.addManualWatchButton.addEventListener("click", addManualWatchlistPlayer);
}

function renderTabs() {
  elements.sportTabs.innerHTML = "";
  for (const [sport, label] of SPORTS) {
    const button = document.createElement("button");
    const count = state?.players?.filter((player) => player.sport === sport && player.boardType === currentBoard).length ?? 0;
    button.textContent = state ? `${label} ${count}` : label;
    button.addEventListener("click", () => {
      currentSport = sport;
      currentPositionGroup = "ALL";
      renderTabs();
      render();
    });
    if (sport === currentSport) {
      button.classList.add("active");
    }
    elements.sportTabs.append(button);
  }

  elements.boardTabs.innerHTML = "";
  for (const [board, label] of BOARDS) {
    const button = document.createElement("button");
    const count = state?.players?.filter((player) => player.sport === currentSport && player.boardType === board).length ?? 0;
    button.textContent = state ? `${label} ${count}` : label;
    button.addEventListener("click", () => {
      currentBoard = board;
      renderTabs();
      render();
    });
    if (board === currentBoard) {
      button.classList.add("active");
    }
    elements.boardTabs.append(button);
  }

  elements.positionTabs.innerHTML = "";
  for (const [positionGroup, label] of POSITION_GROUPS[currentSport]) {
    const button = document.createElement("button");
    const count = state?.players?.filter((player) => player.sport === currentSport && player.boardType === currentBoard && (positionGroup === "ALL" || normalizePositionGroup(player) === positionGroup)).length ?? 0;
    button.textContent = state ? `${label} ${count}` : label;
    button.addEventListener("click", () => {
      currentPositionGroup = positionGroup;
      renderTabs();
      render();
    });
    if (positionGroup === currentPositionGroup) {
      button.classList.add("active");
    }
    elements.positionTabs.append(button);
  }
}

function render() {
  renderTabs();
  renderBoard();
  renderNeeds();
  renderSidebars();
  renderCounts();
  elements.strategyInput.value = state.settings.strategy[currentSport] ?? "";
  renderFantasyProsKeyStatus();
}

function renderFantasyProsKeyStatus() {
  elements.fantasyProsKeyStatus.textContent = state.settings.integrations?.hasFantasyProsApiKey
    ? "FantasyPros key saved locally."
    : "No FantasyPros key saved locally.";
}

function renderBoard() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const sportLabel = SPORTS.find(([sport]) => sport === currentSport)?.[1] ?? currentSport;
  const boardLabel = BOARDS.find(([board]) => board === currentBoard)?.[1] ?? currentBoard;
  elements.boardTitle.textContent = `${sportLabel} ${boardLabel}`;
  elements.playerList.innerHTML = "";

  const players = state.players
    .filter((player) => player.sport === currentSport && player.boardType === currentBoard)
    .filter((player) => currentPositionGroup === "ALL" || normalizePositionGroup(player) === currentPositionGroup)
    .filter((player) => !query || [player.displayName, player.position, player.team, state.notes[player.id], player.injuryStatus, player.upsideNote].filter(Boolean).join(" ").toLowerCase().includes(query))
    .filter((player) => !hideCrossedOff || !state.crossedOff.includes(player.id))
    .sort(comparePlayers)
    .slice(0, 140);

  if (players.length === 0) {
    elements.playerList.innerHTML = `<p class="hint">No players for this tab yet. Try another tab with a count, sync FantasyPros, or paste CSV rankings.</p>`;
    return;
  }

  for (const player of players) {
    elements.playerList.append(renderPlayerCard(player));
  }
}

function renderPlayerCard(player) {
  const node = elements.playerTemplate.content.firstElementChild.cloneNode(true);
  const crossed = state.crossedOff.includes(player.id);
  const watched = state.watchlist.includes(player.id);
  const dnd = state.doNotDraft.includes(player.id);
  node.classList.toggle("crossed", crossed);
  node.querySelector(".rank").textContent = player.rank ?? "-";
  node.querySelector(".player-name").textContent = player.displayName;
  node.querySelector(".player-meta").textContent = [normalizePositionGroup(player), player.position, player.team, player.source, player.injuryStatus].filter(Boolean).join(" • ");
  node.querySelector(".note-input").value = state.notes[player.id] ?? "";
  node.querySelector(".note-input").addEventListener("change", (event) => {
    state.notes[player.id] = event.target.value;
    saveState();
  });

  const badges = node.querySelector(".badges");
  if (player.tier) {
    badges.append(badge(`Tier ${player.tier}`, "gold"));
  }
  if (watched) {
    badges.append(badge("Watch", "sky"));
  }
  if (player.source === "Manual Watchlist") {
    badges.append(badge("Manual", "gold"));
  }
  if (dnd) {
    badges.append(badge("DND", "rose"));
  }
  if (isInjuryUpside(player)) {
    badges.append(badge("Injury upside", "rose"));
  }

  const crossButton = node.querySelector(".cross-button");
  crossButton.textContent = crossed ? "Restore" : "Cross off";
  crossButton.addEventListener("click", () => {
    toggleListValue("crossedOff", player.id);
    render();
    saveState();
  });

  node.querySelector(".roster-button").addEventListener("click", () => {
    state.roster.push({
      playerId: player.id,
      displayName: player.displayName,
      sport: player.sport,
      position: player.position,
      team: player.team,
      boardType: currentBoard,
      addedAt: new Date().toISOString(),
    });
    if (!state.crossedOff.includes(player.id)) {
      state.crossedOff.push(player.id);
    }
    render();
    saveState();
  });

  const watchButton = node.querySelector(".watch-button");
  watchButton.textContent = watched ? "Unwatch" : "Watch";
  watchButton.addEventListener("click", () => {
    toggleListValue("watchlist", player.id);
    render();
    saveState();
  });

  const dnfButton = node.querySelector(".dnf-button");
  dnfButton.textContent = dnd ? "Allow" : "DND";
  dnfButton.addEventListener("click", () => {
    toggleListValue("doNotDraft", player.id);
    render();
    saveState();
  });

  return node;
}

function renderNeeds() {
  elements.rosterNeeds.innerHTML = "";
  for (const [sport, label] of SPORTS) {
    const target = state.settings.rosterTargets[sport] ?? 0;
    const count = state.roster.filter((entry) => entry.sport === sport).length;
    const percent = target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;
    const row = document.createElement("div");
    row.className = "need-row";
    row.innerHTML = `
      <div><strong>${label}</strong><span>${count}/${target}</span></div>
      <div class="bar"><span style="width:${percent}%"></span></div>
    `;
    elements.rosterNeeds.append(row);
  }
}

function renderSidebars() {
  elements.myRoster.innerHTML = "";
  const roster = state.roster.filter((entry) => entry.sport === currentSport).slice().reverse();
  if (roster.length === 0) {
    elements.myRoster.innerHTML = `<p class="hint">No ${currentSport.toLowerCase()} players on your roster yet.</p>`;
  } else {
    for (const entry of roster) {
      elements.myRoster.append(miniItem(entry.displayName, [entry.position, entry.team].filter(Boolean).join(" • "), () => {
        state.roster = state.roster.filter((rosterEntry) => rosterEntry !== entry);
        render();
        saveState();
      }));
    }
  }

  elements.injuryUpside.innerHTML = "";
  const injuryPlayers = state.players
    .filter((player) => player.sport === currentSport && player.boardType === currentBoard && isInjuryUpside(player) && !state.crossedOff.includes(player.id))
    .sort((left, right) => (left.rank ?? 9999) - (right.rank ?? 9999))
    .slice(0, 10);
  if (injuryPlayers.length === 0) {
    elements.injuryUpside.innerHTML = `<p class="hint">No injury-upside flags on this board yet.</p>`;
  } else {
    for (const player of injuryPlayers) {
      elements.injuryUpside.append(miniItem(player.displayName, [player.injuryStatus, player.upsideNote].filter(Boolean).join(" • ")));
    }
  }

  elements.recentSyncs.innerHTML = "";
  for (const sync of state.syncs.slice(0, 12)) {
    const failureText = sync.failures?.length ? ` • ${sync.failures.length} failed` : "";
    const firstFailureText = sync.failures?.[0]?.error ? ` • First failure: ${summarizeSyncError(sync.failures[0].error)}` : "";
    const requestText = sync.requestCount ? ` • ${sync.requestCount} requests` : "";
    const resultText = sync.results?.length
      ? ` • ${sync.results.map((entry) => `${entry.sport[0]}${entry.boardType[0]}${entry.position ? ` ${entry.position}` : ""}:${entry.imported}${entry.pagesFetched ? `/${entry.pagesFetched}p` : ""}`).join(", ")}`
      : "";
    elements.recentSyncs.append(miniItem(`${sync.source} ${sync.sport}`, `${sync.boardType ?? ""} • ${sync.imported} players${requestText}${failureText}${resultText}${firstFailureText} • ${new Date(sync.at).toLocaleString()}`));
  }
}

function renderCounts() {
  const currentPlayers = state.players.filter((player) => player.sport === currentSport && player.boardType === currentBoard);
  elements.availableCount.textContent = currentPlayers.filter((player) => !state.crossedOff.includes(player.id)).length;
  elements.crossedOffCount.textContent = state.crossedOff.length;
  elements.watchlistCount.textContent = state.watchlist.length;
  elements.rosterCount.textContent = state.roster.length;
}

function badge(text, tone) {
  const span = document.createElement("span");
  span.className = `badge ${tone}`;
  span.textContent = text;
  return span;
}

function miniItem(title, subtitle, onRemove) {
  const item = document.createElement("div");
  item.className = "mini-item";
  item.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle || "")}</span>`;
  if (onRemove) {
    const button = document.createElement("button");
    button.className = "secondary";
    button.textContent = "Remove";
    button.addEventListener("click", onRemove);
    item.append(button);
  }
  return item;
}

function bestAvailableScore(player) {
  let score = Number(player.rank ?? 9999);
  if (state.watchlist.includes(player.id)) {
    score -= player.source === "Manual Watchlist" ? 9800 : 8;
  }
  if (state.doNotDraft.includes(player.id)) {
    score += 400;
  }
  if (isInjuryUpside(player) && currentBoard === "dynasty") {
    score -= 4;
  }
  return score;
}

function comparePlayers(left, right) {
  const leftPositionIndex = positionSortIndex(left);
  const rightPositionIndex = positionSortIndex(right);
  if (leftPositionIndex !== rightPositionIndex) {
    return leftPositionIndex - rightPositionIndex;
  }

  return bestAvailableScore(left) - bestAvailableScore(right);
}

function positionSortIndex(player) {
  const order = POSITION_GROUPS[player.sport]?.map(([positionGroup]) => positionGroup).filter((positionGroup) => positionGroup !== "ALL") ?? [];
  const index = order.indexOf(normalizePositionGroup(player));
  return index === -1 ? 999 : index;
}

function normalizePlayerForClient(player) {
  return {
    ...player,
    positionGroup: player.positionGroup ?? normalizePositionGroup(player),
  };
}

function normalizePositionGroup(player) {
  const sport = player.sport;
  const value = String(player.positionGroup ?? player.position ?? "").toUpperCase();
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
    if (["QB", "RB", "WR", "TE", "DEF", "DST"].includes(firstPosition)) {
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

  return firstPosition || "Other";
}

async function addManualWatchlistPlayer() {
  const playerName = elements.manualWatchNameInput.value.trim();
  if (!playerName) {
    alert("Enter a player/prospect name first.");
    return;
  }

  const result = await requestJson("/api/watchlist/manual", {
    method: "POST",
    body: JSON.stringify({
      playerName,
      sport: currentSport,
      boardType: currentBoard,
      position: elements.manualWatchPositionInput.value,
      team: elements.manualWatchTeamInput.value,
      note: elements.manualWatchNoteInput.value,
    }),
  });

  state = result.state;
  state.players = state.players.map(normalizePlayerForClient);
  elements.manualWatchNameInput.value = "";
  elements.manualWatchPositionInput.value = "";
  elements.manualWatchTeamInput.value = "";
  elements.manualWatchNoteInput.value = "";
  render();
}

function isInjuryUpside(player) {
  return /inj|out|ir|pup|questionable|doubtful|surgery|rehab/i.test([player.injuryStatus, player.upsideNote, state.notes[player.id]].filter(Boolean).join(" "));
}

function toggleListValue(key, value) {
  state[key] = state[key].includes(value) ? state[key].filter((entry) => entry !== value) : [...state[key], value];
}

async function saveState() {
  state = await requestJson("/api/state", {
    method: "PUT",
    body: JSON.stringify(state),
  });
  state.players = state.players.map(normalizePlayerForClient);
  render();
}

async function importCsv() {
  const text = elements.csvInput.value.trim();
  if (!text) {
    alert("Paste CSV rankings first.");
    return;
  }

  const result = await requestJson("/api/import/csv", {
    method: "POST",
    body: JSON.stringify({
      text,
      sport: currentSport,
      boardType: currentBoard,
      source: elements.csvSourceInput.value,
    }),
  });
  state = result.state;
  state.players = state.players.map(normalizePlayerForClient);
  elements.csvInput.value = "";
  render();
}

async function saveFantasyProsKey() {
  const apiKey = elements.fantasyProsApiKeyInput.value.trim();
  if (!apiKey) {
    alert("Paste a FantasyPros API key first.");
    return;
  }

  state = await requestJson("/api/settings/fantasypros-key", {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
  state.players = state.players.map(normalizePlayerForClient);
  elements.fantasyProsApiKeyInput.value = "";
  render();
}

async function syncFantasyPros() {
  const season = prompt("FantasyPros season/year?", String(new Date().getFullYear()));
  if (!season) {
    return;
  }
  const position = prompt("Position? Use ALL if unsure.", "ALL");
  if (!position) {
    return;
  }

  try {
    const result = await requestJson("/api/sync/fantasypros", {
      method: "POST",
      body: JSON.stringify({
        sport: currentSport,
        boardType: currentBoard,
        season: Number(season),
        position,
      }),
    });
    state = result.state;
    state.players = state.players.map(normalizePlayerForClient);
    render();
  } catch (error) {
    alert(error.message);
  }
}

async function debugFantasyPros() {
  const season = prompt("FantasyPros season/year?", String(new Date().getFullYear()));
  if (!season) {
    return;
  }
  const position = prompt("Position to test? Use a real position like C, OF, QB, PG.", getDefaultPositionForSport(currentSport));
  if (!position) {
    return;
  }

  try {
    const result = await requestJson("/api/debug/fantasypros", {
      method: "POST",
      body: JSON.stringify({
        sport: currentSport,
        boardType: currentBoard,
        season: Number(season),
        position,
      }),
    });
    const lines = result.tests
      .slice(0, 12)
      .map((test) => `${test.endpoint} / ${test.auth} / ${test.keySource}: ${test.status} ${test.ok ? "OK" : summarizeSyncError(test.bodySnippet)}`);
    alert(lines.join("\n"));
  } catch (error) {
    alert(error.message);
  }
}

function getDefaultPositionForSport(sport) {
  return {
    HOCKEY: "C",
    BASEBALL: "OF",
    FOOTBALL: "QB",
    BASKETBALL: "PG",
    GOLF: "ALL",
  }[sport] ?? "ALL";
}

async function syncAllFantasyPros() {
  const season = prompt("FantasyPros season/year for every sport and board?", String(new Date().getFullYear()));
  if (!season) {
    return;
  }
  const confirmed = confirm("This will sync consensus rankings by position for Hockey, Baseball, Football, and Basketball across both boards. This can use many FantasyPros API calls. Continue?");
  if (!confirmed) {
    return;
  }

  elements.syncAllFantasyProsButton.disabled = true;
  elements.syncAllFantasyProsButton.textContent = "Syncing boards...";

  try {
    const result = await requestJson("/api/sync/fantasypros/all", {
      method: "POST",
      body: JSON.stringify({
        season: Number(season),
        position: "ALL",
      }),
    });
    state = result.state;
    state.players = state.players.map(normalizePlayerForClient);
    const firstImported = result.results.find((entry) => entry.imported > 0);
    if (firstImported) {
      currentSport = firstImported.sport;
      currentBoard = firstImported.boardType;
    }
    render();
    const imported = result.results.reduce((total, entry) => total + entry.imported, 0);
    const failureSummary = result.failures.length ? `\n\nFirst failure: ${summarizeSyncError(result.failures[0].error)}` : "";
    alert(`FantasyPros batch sync complete. Imported ${imported} players. Failures: ${result.failures.length}.${failureSummary}`);
  } catch (error) {
    alert(error.message);
  } finally {
    elements.syncAllFantasyProsButton.disabled = false;
    elements.syncAllFantasyProsButton.textContent = "Sync all FantasyPros boards once";
  }
}

function summarizeSyncError(error) {
  return String(error ?? "")
    .replace(/\s+/g, " ")
    .replaceAll('{"message":"Forbidden"}', "Forbidden")
    .trim()
    .slice(0, 260);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
