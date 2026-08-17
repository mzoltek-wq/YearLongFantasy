"use client";

import { useEffect, useMemo, useState } from "react";

type BoardType = "redraft" | "dynasty";
type Sport = "HOCKEY" | "BASEBALL" | "FOOTBALL" | "BASKETBALL" | "GOLF";

type TakenPlayer = {
  displayName: string;
  normalizedName: string;
  sport: Sport | null;
  managerName: string | null;
  round: number | null;
  overallPickNumber: number | null;
  selectionType: "KEEPER" | "DRAFTED";
  source: string;
};

type AssistantPlayer = {
  id: string;
  normalizedName: string;
  displayName: string;
  sport: Sport;
  boardType: BoardType;
  source: string;
  rank: number | null;
  position: string | null;
  positionGroup: string | null;
  team: string | null;
  tier: number | null;
  injuryStatus: string | null;
  upsideNote: string | null;
  isTaken: boolean;
  taken: TakenPlayer | null;
  isManualWatch?: boolean;
};

type AssistantState = {
  players: AssistantPlayer[];
  unavailablePlayers: TakenPlayer[];
  generatedAt: string;
};

type ManualWatchEntry = {
  id: string;
  displayName: string;
  normalizedName: string;
  sport: Sport;
};

type MagicDraftAssistantProps = {
  storageKeyPrefix?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
};

const sports: Array<[Sport, string]> = [
  ["HOCKEY", "Hockey"],
  ["BASEBALL", "Baseball"],
  ["FOOTBALL", "Football"],
  ["BASKETBALL", "Basketball"],
  ["GOLF", "Golf"],
];

const boards: Array<[BoardType, string]> = [
  ["redraft", "Year to year"],
  ["dynasty", "Dynasty"],
];

const positionGroups: Record<Sport, Array<[string, string]>> = {
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
    ["FLEX", "Flex"],
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

const sportEmoji: Record<Sport, string> = {
  HOCKEY: "🏒",
  BASEBALL: "⚾️",
  FOOTBALL: "🏈",
  BASKETBALL: "🏀",
  GOLF: "⛳",
};

function useLocalStringArray(key: string) {
  const [values, setValues] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      return [];
    }

    return [];
  });

  function update(nextValues: string[]) {
    setValues(nextValues);
    window.localStorage.setItem(key, JSON.stringify(nextValues));
  }

  return [values, update] as const;
}

function useLocalString(key: string) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(key) ?? "";
  });

  function update(nextValue: string) {
    setValue(nextValue);
    window.localStorage.setItem(key, nextValue);
  }

  return [value, update] as const;
}

function useLocalManualWatchEntries(key: string) {
  const [values, setValues] = useState<ManualWatchEntry[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      return [];
    }

    return [];
  });

  function update(nextValues: ManualWatchEntry[]) {
    setValues(nextValues);
    window.localStorage.setItem(key, JSON.stringify(nextValues));
  }

  return [values, update] as const;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTaken(taken: TakenPlayer | null) {
  if (!taken) {
    return "";
  }

  const verb = taken.selectionType === "KEEPER" ? "Kept" : "Drafted";
  const manager = taken.managerName ? ` by ${taken.managerName}` : "";
  const pick = taken.overallPickNumber ? ` at pick ${taken.overallPickNumber}` : "";
  const round = taken.round ? `, round ${taken.round}` : "";
  return `${verb}${manager}${pick}${round}`;
}

function matchesPositionGroup(player: AssistantPlayer, selectedGroup: string) {
  if (selectedGroup === "ALL") {
    return true;
  }

  if (player.isManualWatch && !player.positionGroup) {
    return true;
  }

  if (player.sport === "FOOTBALL" && selectedGroup === "FLEX") {
    return ["RB", "WR", "TE"].includes(player.positionGroup ?? "");
  }

  return player.positionGroup === selectedGroup;
}

export function MagicDraftAssistant({
  storageKeyPrefix = "magic-assistant",
  eyebrow = "Zoltek's magic draft assistant",
  title = "Best available, minus reality",
  description = "Hidden private board backed by the league app. Taken players poll from the live draft database every five seconds.",
}: MagicDraftAssistantProps) {
  const [state, setState] = useState<AssistantState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sport, setSport] = useState<Sport>("HOCKEY");
  const [boardType, setBoardType] = useState<BoardType>("redraft");
  const [positionGroup, setPositionGroup] = useState("ALL");
  const [query, setQuery] = useState("");
  const [hideTaken, setHideTaken] = useState(true);
  const [showWatchOnly, setShowWatchOnly] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [manualWatchName, setManualWatchName] = useState("");
  const [manualWatchSport, setManualWatchSport] = useState<Sport>("FOOTBALL");
  const [watchlist, setWatchlist] = useLocalStringArray(`${storageKeyPrefix}-watchlist`);
  const [doNotDraft, setDoNotDraft] = useLocalStringArray(`${storageKeyPrefix}-dnd`);
  const [manualCrossedOff, setManualCrossedOff] = useLocalStringArray(`${storageKeyPrefix}-crossed-off`);
  const [manualWatchEntries, setManualWatchEntries] = useLocalManualWatchEntries(`${storageKeyPrefix}-manual-watchlist`);
  const [draftNotes, setDraftNotes] = useLocalString(`${storageKeyPrefix}-notes`);

  function addManualWatchEntry() {
    const displayName = manualWatchName.trim();
    const normalizedName = normalizeName(displayName);

    if (!displayName || !normalizedName) {
      return;
    }

    const existingPlayerIds = (state?.players ?? [])
      .filter((player) => player.sport === manualWatchSport && player.normalizedName === normalizedName)
      .map((player) => player.id);

    if (existingPlayerIds.length) {
      setWatchlist(Array.from(new Set([...watchlist, ...existingPlayerIds])));
      setManualWatchName("");
      return;
    }

    const id = `manual:${manualWatchSport}:${normalizedName}`;
    if (!manualWatchEntries.some((entry) => entry.id === id)) {
      setManualWatchEntries([...manualWatchEntries, { displayName, id, normalizedName, sport: manualWatchSport }]);
    }
    setManualWatchName("");
  }

  async function loadState({ quiet = false } = {}) {
    try {
      if (!quiet) {
        setError(null);
      }
      const response = await fetch("/api/zolteksmagicdraftassistant/state", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setState(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load assistant data.");
    }
  }

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      loadState();
    }, 0);
    const timer = window.setInterval(() => {
      loadState({ quiet: true });
    }, 5000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  const players = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const takenByName = new Map(
      (state?.unavailablePlayers ?? [])
        .filter((taken) => taken.sport)
        .map((taken) => [`${taken.sport}:${taken.normalizedName}`, taken] as const),
    );
    const manualPlayers: AssistantPlayer[] = manualWatchEntries.map((entry) => {
      const taken = takenByName.get(`${entry.sport}:${entry.normalizedName}`) ?? null;

      return {
        boardType,
        displayName: entry.displayName,
        id: entry.id,
        injuryStatus: null,
        isManualWatch: true,
        isTaken: Boolean(taken),
        normalizedName: entry.normalizedName,
        position: null,
        positionGroup: null,
        rank: null,
        source: "Manual watchlist",
        sport: entry.sport,
        taken,
        team: null,
        tier: null,
        upsideNote: "Manual reminder",
      };
    });

    return [...(state?.players ?? []), ...manualPlayers]
      .filter((player) => player.sport === sport && player.boardType === boardType)
      .filter((player) => matchesPositionGroup(player, positionGroup))
      .filter((player) => {
        if (!normalizedQuery) {
          return true;
        }
        return [player.displayName, player.position, player.positionGroup, player.team, player.source, player.upsideNote, player.injuryStatus]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .filter((player) => !showWatchOnly || player.isManualWatch || watchlist.includes(player.id))
      .filter((player) => normalizedQuery || !hideTaken || (!player.isTaken && !manualCrossedOff.includes(player.id)))
      .sort((left, right) => {
        if (left.isManualWatch !== right.isManualWatch) {
          return left.isManualWatch ? -1 : 1;
        }
        if (watchlist.includes(left.id) !== watchlist.includes(right.id)) {
          return watchlist.includes(left.id) ? -1 : 1;
        }
        if (doNotDraft.includes(left.id) !== doNotDraft.includes(right.id)) {
          return doNotDraft.includes(left.id) ? 1 : -1;
        }
        return (left.rank ?? 999999) - (right.rank ?? 999999);
      })
      .slice(0, 180);
  }, [boardType, doNotDraft, hideTaken, manualCrossedOff, manualWatchEntries, positionGroup, query, showWatchOnly, sport, state?.players, state?.unavailablePlayers, watchlist]);

  const currentBoardPlayers = (state?.players ?? []).filter((player) => player.sport === sport && player.boardType === boardType);
  const takenCount = currentBoardPlayers.filter((player) => player.isTaken || manualCrossedOff.includes(player.id)).length;
  const availableCount = currentBoardPlayers.length - takenCount;
  const watchCount = watchlist.length + manualWatchEntries.length;

  return (
    <div className="min-h-screen bg-[#0f172a] text-[#f8fafc]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.45em] text-emerald-200/80">{eyebrow}</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">{description}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-2xl bg-emerald-400/15 px-4 py-3">
                <div className="text-2xl font-black">{availableCount}</div>
                <div className="text-xs uppercase tracking-[0.25em] text-emerald-100/80">Available</div>
              </div>
              <div className="rounded-2xl bg-rose-400/15 px-4 py-3">
                <div className="text-2xl font-black">{takenCount}</div>
                <div className="text-xs uppercase tracking-[0.25em] text-rose-100/80">Taken</div>
              </div>
              <button
                aria-pressed={showWatchOnly}
                className={`rounded-2xl px-4 py-3 transition ${
                  showWatchOnly ? "bg-sky-300 text-slate-950 ring-2 ring-sky-100" : "bg-sky-400/15 text-white hover:bg-sky-400/25"
                }`}
                onClick={() => setShowWatchOnly((current) => !current)}
                type="button"
              >
                <div className="text-2xl font-black">{watchCount}</div>
                <div className={`text-xs uppercase tracking-[0.25em] ${showWatchOnly ? "text-slate-800" : "text-sky-100/80"}`}>Watch</div>
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-3 rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
          <div className="flex flex-wrap gap-2">
            {sports.map(([value, label]) => (
              <button
                className={`rounded-full border px-4 py-2 text-sm font-bold transition ${sport === value ? "border-emerald-300 bg-emerald-300 text-slate-950" : "border-white/10 bg-white/5 text-slate-200 hover:border-emerald-200"}`}
                key={value}
                onClick={() => {
                  setSport(value);
                  setPositionGroup("ALL");
                }}
                type="button"
              >
                {sportEmoji[value]} {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {boards.map(([value, label]) => (
              <button
                className={`rounded-full border px-4 py-2 text-sm font-bold transition ${boardType === value ? "border-sky-300 bg-sky-300 text-slate-950" : "border-white/10 bg-white/5 text-slate-200 hover:border-sky-200"}`}
                key={value}
                onClick={() => setBoardType(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {positionGroups[sport].map(([value, label]) => (
              <button
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${positionGroup === value ? "border-amber-200 bg-amber-200 text-slate-950" : "border-white/10 bg-white/5 text-slate-300 hover:border-amber-100"}`}
                key={value}
                onClick={() => setPositionGroup(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-base text-white outline-none ring-emerald-300/40 placeholder:text-slate-500 focus:ring-4"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search player, team, position, note"
              value={query}
            />
            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-200">
              <input checked={hideTaken} onChange={(event) => setHideTaken(event.target.checked)} type="checkbox" />
              Hide taken
            </label>
            {showWatchOnly ? (
              <button className="rounded-2xl border border-sky-200/40 bg-sky-300/15 px-4 py-3 text-sm font-black text-sky-100" onClick={() => setShowWatchOnly(false)} type="button">
                Showing watchlist
              </button>
            ) : null}
            <button
              aria-pressed={showNotes}
              className={`rounded-2xl px-4 py-3 text-sm font-black ${showNotes ? "bg-amber-200 text-slate-950" : "border border-white/10 bg-white/5 text-slate-200"}`}
              onClick={() => setShowNotes((current) => !current)}
              type="button"
            >
              Notes
            </button>
            <button className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950" onClick={() => loadState()} type="button">
              Refresh now
            </button>
          </div>

          {showNotes ? (
            <div className="rounded-2xl border border-amber-200/20 bg-amber-200/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-black text-amber-100">Draft notes</p>
                <p className="text-xs text-amber-100/70">Auto-saved on this device</p>
              </div>
              <textarea
                className="min-h-36 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-6 text-white outline-none ring-amber-200/30 placeholder:text-slate-500 focus:ring-4"
                onChange={(event) => setDraftNotes(event.target.value)}
                placeholder={"Targets, position reminders, little bits of draft goblin math...\nExample: Round 12-18 hunt upside WR/RB. Wait on golf unless value falls."}
                value={draftNotes}
              />
            </div>
          ) : null}

          <form
            className="grid gap-3 rounded-2xl border border-sky-200/20 bg-sky-300/10 p-3 md:grid-cols-[1fr_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              addManualWatchEntry();
            }}
          >
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-base text-white outline-none ring-sky-300/40 placeholder:text-slate-500 focus:ring-4"
              onChange={(event) => setManualWatchName(event.target.value)}
              placeholder="Manually add player to watchlist"
              value={manualWatchName}
            />
            <select
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-base font-bold text-white outline-none ring-sky-300/40 focus:ring-4"
              onChange={(event) => setManualWatchSport(event.target.value as Sport)}
              value={manualWatchSport}
            >
              {sports.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button className="rounded-2xl bg-sky-300 px-4 py-3 text-sm font-black text-slate-950" type="submit">
              Add watch
            </button>
          </form>

          <div className="text-xs text-slate-400">
            {error ? <span className="text-rose-200">Assistant refresh failed: {error}</span> : null}
            {!error && state?.generatedAt ? <span>Last live check: {new Date(state.generatedAt).toLocaleTimeString()}</span> : null}
          </div>
        </section>

        <main className="grid gap-3">
          {players.map((player) => {
            const watched = watchlist.includes(player.id);
            const dnd = doNotDraft.includes(player.id);
            const crossed = manualCrossedOff.includes(player.id);
            const unavailable = player.isTaken || crossed;

            return (
              <article
                className={`rounded-[1.5rem] border p-4 shadow-xl shadow-black/10 transition ${
                  unavailable ? "border-rose-300/25 bg-rose-950/25 opacity-70" : watched ? "border-sky-200/40 bg-sky-950/25" : "border-white/10 bg-white/[0.07]"
                }`}
                key={player.id}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-slate-950">#{player.rank ?? "-"}</span>
                      <h2 className="text-xl font-black">{player.displayName}</h2>
                      {player.isManualWatch ? <span className="rounded-full bg-sky-300 px-3 py-1 text-xs font-black text-sky-950">Manual watch</span> : null}
                      {player.isTaken ? <span className="rounded-full bg-rose-300 px-3 py-1 text-xs font-black text-rose-950">Taken / kept</span> : null}
                      {crossed && !player.isTaken ? <span className="rounded-full bg-rose-300 px-3 py-1 text-xs font-black text-rose-950">Crossed off</span> : null}
                      {watched ? <span className="rounded-full bg-sky-300 px-3 py-1 text-xs font-black text-sky-950">Watch</span> : null}
                      {dnd ? <span className="rounded-full bg-zinc-300 px-3 py-1 text-xs font-black text-zinc-950">DND</span> : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-300">
                      {[sportEmoji[player.sport], player.positionGroup, player.position, player.team, player.source].filter(Boolean).join(" • ")}
                    </p>
                    {player.taken ? <p className="mt-2 text-sm font-bold text-rose-100">{formatTaken(player.taken)}</p> : null}
                    {player.injuryStatus || player.upsideNote ? (
                      <p className="mt-2 rounded-2xl bg-amber-200/10 px-3 py-2 text-sm text-amber-100">
                        {[player.injuryStatus, player.upsideNote].filter(Boolean).join(" • ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {player.isManualWatch ? (
                      <button className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200" onClick={() => setManualWatchEntries(manualWatchEntries.filter((entry) => entry.id !== player.id))} type="button">
                        Remove
                      </button>
                    ) : (
                      <button className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200" onClick={() => setWatchlist(toggleValue(watchlist, player.id))} type="button">
                        {watched ? "Unwatch" : "Watch"}
                      </button>
                    )}
                    <button className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200" onClick={() => setDoNotDraft(toggleValue(doNotDraft, player.id))} type="button">
                      {dnd ? "Allow" : "DND"}
                    </button>
                    <button className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200" onClick={() => setManualCrossedOff(toggleValue(manualCrossedOff, player.id))} type="button">
                      {crossed ? "Restore" : "Cross off"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}

          {!players.length ? (
            <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-8 text-center text-slate-300">
              No players match this view. If you searched for a taken player, clear position filters or turn off hide taken.
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
