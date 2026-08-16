"use client";

import { Sport } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { SPORT_EMOJIS, SPORT_LABELS, SPORTS } from "@/lib/constants/league";
import type { LeagueSnapshot } from "@/lib/types/draft";

type DraftBoardClientProps = {
  initialSnapshot: LeagueSnapshot;
  mode?: "commissioner" | "tracker";
  trackerStickyClassName?: string;
};

type PlayerResolution = {
  playerName: string;
  matchedDisplayName: string | null;
  sport: Sport | null;
  sportSource: "player-db" | "typed-value" | "unknown";
  positions: string[];
  positionSource: "player-db" | "typed-value" | "default" | "unknown";
  team: string | null;
  warnings: string[];
  rosterWarnings: string[];
};

async function requestJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }

  return data;
}

export function DraftBoardClient({ initialSnapshot, mode = "commissioner", trackerStickyClassName = "top-2" }: DraftBoardClientProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [playerName, setPlayerName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [playerResolution, setPlayerResolution] = useState<PlayerResolution | null>(null);
  const [isResolvingPlayer, setIsResolvingPlayer] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const data = await requestJson<LeagueSnapshot>("/api/draft");
    setSnapshot(data);
  }

  const currentPick = snapshot.draftWindow.currentPick;
  const nextPick = snapshot.draftWindow.nextPick;
  const isTrackerMode = mode === "tracker";
  const recentPickLimit = isTrackerMode ? 10 : 5;
  const upcomingPickLimit = isTrackerMode ? 10 : 5;

  useEffect(() => {
    const interval = setInterval(() => {
      refresh().catch(() => null);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const trimmedPlayerName = playerName.trim();

    if (!currentPick || trimmedPlayerName.length < 2) {
      return;
    }

    let isCurrent = true;
    const timeout = setTimeout(() => {
      requestJson<PlayerResolution>("/api/draft/resolve-player", {
        method: "POST",
        body: JSON.stringify({
          overallPickNumber: currentPick.overallPickNumber,
          playerName: trimmedPlayerName,
        }),
      })
        .then((resolution) => {
          if (isCurrent) {
            setPlayerResolution(resolution);
          }
        })
        .catch(() => {
          if (isCurrent) {
            setPlayerResolution(null);
          }
        })
        .finally(() => {
          if (isCurrent) {
            setIsResolvingPlayer(false);
          }
        });
    }, 250);

    return () => {
      isCurrent = false;
      clearTimeout(timeout);
    };
  }, [currentPick, playerName]);

  const completedPicks = useMemo(
    () =>
      [...snapshot.slots]
        .filter((slot) => slot.selectedPlayerName && !slot.isKeeper && slot.selectedAt)
        .sort((left, right) => {
          const leftTime = left.selectedAt ? new Date(left.selectedAt).getTime() : 0;
          const rightTime = right.selectedAt ? new Date(right.selectedAt).getTime() : 0;
          return rightTime - leftTime;
        }),
    [snapshot.slots],
  );
  const recentPickList = completedPicks.slice(0, recentPickLimit);
  const recentPickGridSlots = completedPicks.slice(0, 25);
  const upcomingPicks = useMemo(
    () =>
      snapshot.slots
        .filter((slot) => !slot.selectedPlayerName)
        .slice(0, upcomingPickLimit),
    [snapshot.slots, upcomingPickLimit],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [];
    }

    return snapshot.slots.filter((slot) => {
      if (!slot.selectedPlayerName) {
        return false;
      }

      return slot.selectedPlayerName.toLowerCase().includes(normalizedSearchQuery);
    });
  }, [normalizedSearchQuery, snapshot.slots]);
  const mobilePickGridSlots = normalizedSearchQuery ? searchResults : recentPickGridSlots;

  const ownerRosterDrilldown = useMemo(
    () =>
      snapshot.ownerTotals.map((row) => {
        const ownerSlots = snapshot.slots.filter((slot) => slot.currentOwnerId === row.owner.id && slot.selectedPlayerName && slot.selectedSport);

        return {
          ...row,
          sports: SPORTS.map((entry) => ({
            sport: entry,
            count: row.bySport[entry].count,
            limit: row.bySport[entry].limit,
            status: row.bySport[entry].status,
            players: ownerSlots
              .filter((slot) => slot.selectedSport === entry)
              .map((slot) => ({
                id: slot.id,
                name: slot.selectedPlayerName!,
                isKeeper: slot.isKeeper,
                round: slot.round,
                overallPickNumber: slot.overallPickNumber,
              })),
          })),
        };
      }),
    [snapshot.ownerTotals, snapshot.slots],
  );

  async function submitPick(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!currentPick) {
      setError("The draft is complete.");
      return;
    }

    try {
      await requestJson("/api/draft/picks", {
        method: "POST",
        body: JSON.stringify({
          overallPickNumber: currentPick.overallPickNumber,
          playerName,
        }),
      });
      setPlayerName("");
      setPlayerResolution(null);
      setMessage(`Saved pick ${currentPick.overallPickNumber}.`);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not save pick.");
    }
  }

  async function undoPick(overallPickNumber: number) {
    setError(null);
    setMessage(null);

    try {
      await requestJson("/api/draft/picks", {
        method: "DELETE",
        body: JSON.stringify({ overallPickNumber }),
      });
      setMessage(`Cleared pick ${overallPickNumber}.`);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not undo pick.");
    }
  }

  return (
    <div className="space-y-6">
      <div className={`grid gap-6 ${isTrackerMode ? "" : "xl:grid-cols-[1.15fr_2fr]"}`}>
        {!isTrackerMode ? (
          <div className="space-y-6 rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Draft pulse</p>
            <h2 className="text-2xl font-semibold">{snapshot.draftWindow.completed ? "Draft complete" : `Pick ${currentPick?.overallPickNumber}`}</h2>
            {currentPick ? (
              <div className="space-y-1 text-sm text-[var(--muted)]">
                <p>
                  Current owner: <span className="font-semibold text-[var(--ink)]">{currentPick.currentOwner.name}</span>
                </p>
                <p>
                  Round {currentPick.round}, slot {currentPick.slotNumber}
                </p>
                <p>
                  Next up: <span className="font-semibold text-[var(--ink)]">{nextPick?.currentOwner.name ?? "End of draft"}</span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">All picks are currently filled.</p>
            )}
          </div>

          <form className="space-y-4" onSubmit={submitPick}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="playerName">
                Player name
              </label>
              <input
                className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none ring-0"
                id="playerName"
                onChange={(event) => {
                  const nextPlayerName = event.target.value;
                  setPlayerName(nextPlayerName);
                  setPlayerResolution(null);
                  setIsResolvingPlayer(Boolean(currentPick && nextPlayerName.trim().length >= 2));
                }}
                placeholder="Enter player name"
                value={playerName}
              />
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm">
              {isResolvingPlayer ? (
                <p className="text-[var(--muted)]">Checking player sport and ESPN-style eligibility...</p>
              ) : playerResolution ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{playerResolution.matchedDisplayName ?? playerResolution.playerName}</span>
                    {playerResolution.sport ? (
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[var(--muted)]">
                        {SPORT_EMOJIS[playerResolution.sport]} {SPORT_LABELS[playerResolution.sport]}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Sport unknown</span>
                    )}
                    {playerResolution.positions.length > 0 ? (
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[var(--muted)]">
                        ESPN positions: {playerResolution.positions.join(", ")}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Source: sport from {playerResolution.sportSource.replace("-", " ")}, positions from {playerResolution.positionSource.replace("-", " ")}.
                  </p>
                  {[...playerResolution.warnings, ...playerResolution.rosterWarnings].length > 0 ? (
                    <div className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {[...playerResolution.warnings, ...playerResolution.rosterWarnings].map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Looks eligible based on cached player data.</p>
                  )}
                </div>
              ) : (
                <p className="text-[var(--muted)]">Type a player name to auto-detect sport and roster eligibility.</p>
              )}
            </div>

            <button
              className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!currentPick}
              type="submit"
            >
              Save current pick
            </button>
          </form>

          {message ? <p className="rounded-2xl bg-emerald-100 px-4 py-3 text-sm text-emerald-800">{message}</p> : null}
          {error ? <p className="rounded-2xl bg-rose-100 px-4 py-3 text-sm text-rose-800">{error}</p> : null}

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Roster progress</p>
              <p className="text-sm text-[var(--muted)]">Colors show validation state. Open an owner to see sport counts, then open a sport to see player names.</p>
            </div>
            <div className="space-y-3">
              {ownerRosterDrilldown.map((row) => {
                const ownerToneClass =
                  row.totalStatus === "exact"
                    ? "border-emerald-200 bg-emerald-50"
                    : row.totalStatus === "over"
                      ? "border-rose-200 bg-rose-50"
                      : "border-amber-200 bg-amber-50";

                return (
                  <details className={`rounded-2xl border px-4 py-3 ${ownerToneClass}`} key={row.owner.id}>
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold">{row.owner.name}</p>
                        <p className="text-sm text-[var(--muted)]">
                          {row.totalSelected}/{row.totalSelected + row.picksLeft} players
                        </p>
                      </div>
                    </summary>

                    <div className="mt-3 space-y-2">
                      {row.sports.map((entry) => {
                        const sportToneClass =
                          entry.status === "exact"
                            ? "border-emerald-200 bg-emerald-100/70"
                            : entry.status === "over"
                              ? "border-rose-200 bg-rose-100/70"
                              : "border-amber-200 bg-amber-100/70";

                        return (
                          <details className={`rounded-2xl border px-3 py-3 ${sportToneClass}`} key={`${row.owner.id}-${entry.sport}`}>
                            <summary className="cursor-pointer list-none">
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <p className="font-medium">
                                  {SPORT_EMOJIS[entry.sport]} {SPORT_LABELS[entry.sport]}
                                </p>
                                <p className="text-[var(--muted)]">
                                  {entry.count}/{entry.limit}
                                </p>
                              </div>
                            </summary>

                            <div className="mt-3 space-y-2">
                              {entry.players.length === 0 ? (
                                <p className="text-sm text-[var(--muted)]">No players yet.</p>
                              ) : (
                                entry.players.map((player) => (
                                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/60 bg-white/80 px-3 py-2 text-sm" key={player.id}>
                                    <p className="font-medium">{player.name}</p>
                                    <p className="text-[var(--muted)]">
                                      {player.isKeeper ? `Keeper • R${player.round}` : `Pick ${player.overallPickNumber}`}
                                    </p>
                                  </div>
                                ))
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
          </div>
        ) : null}

        <div className="space-y-6">
          {isTrackerMode ? (
            <div
              className={`sticky ${trackerStickyClassName} z-20 rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/95 px-4 py-3 shadow-lg shadow-slate-900/5 backdrop-blur`}
            >
              {currentPick ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
                  <span className="text-base font-semibold text-[var(--ink)]">
                    R{currentPick.round} · Pick {currentPick.overallPickNumber}
                  </span>
                  <span>
                    Up <span className="font-semibold text-[var(--ink)]">{currentPick.currentOwner.name}</span>
                  </span>
                  <span className="hidden text-[var(--border)] sm:inline">/</span>
                  <span>
                    Next <span className="font-semibold text-[var(--ink)]">{nextPick?.currentOwner.name ?? "End"}</span>
                  </span>
                </div>
              ) : (
                <p className="text-sm font-semibold text-[var(--ink)]">{snapshot.draftWindow.completed ? "Draft complete" : "All picks are currently filled."}</p>
              )}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className={`rounded-[28px] border border-[var(--border)] bg-[var(--surface)] ${isTrackerMode ? "p-4 sm:p-5" : "p-6"}`}>
              <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Recent picks</p>
              <div className={`${isTrackerMode ? "mt-3 space-y-2" : "mt-4 space-y-3"}`}>
                {recentPickList.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No picks have been made yet.</p>
                ) : (
                  recentPickList.map((slot) => (
                    <div className={`rounded-2xl border border-[var(--border)] ${isTrackerMode ? "px-3 py-2.5" : "px-4 py-3"}`} key={slot.id}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">{slot.selectedPlayerName}</p>
                          <p className="text-xs text-[var(--muted)]">
                            Pick {slot.overallPickNumber} • {slot.currentOwner.name}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-[var(--muted)]">
                          <p>{slot.selectedSport ? `${SPORT_EMOJIS[slot.selectedSport]} ${SPORT_LABELS[slot.selectedSport]}` : "—"}</p>
                          <p className="mt-1 rounded-full bg-[var(--surface-strong)] px-2 py-0.5 font-semibold">{slot.isKeeper ? "Keeper" : "Live pick"}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className={`rounded-[28px] border border-[var(--border)] bg-[var(--surface)] ${isTrackerMode ? "p-4 sm:p-5" : "p-6"}`}>
              <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Upcoming picks</p>
              <div className={`${isTrackerMode ? "mt-3 space-y-2" : "mt-4 space-y-3"}`}>
                {upcomingPicks.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No upcoming picks.</p>
                ) : (
                  upcomingPicks.map((slot) => (
                    <div className={`rounded-2xl border border-[var(--border)] ${isTrackerMode ? "px-3 py-2.5" : "px-4 py-3"}`} key={slot.id}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            Pick {slot.overallPickNumber} • {slot.currentOwner.name}
                          </p>
                          <p className="text-xs text-[var(--muted)]">
                            Round {slot.round}, slot {slot.slotNumber}
                          </p>
                        </div>
                        {slot.overrideOwnerCode ? (
                          <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">{slot.overrideOwnerCode}</span>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Player search</p>
                  <p className="text-sm text-[var(--muted)]">Check whether a player has already been taken or kept.</p>
                </div>
                <input
                  className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none ring-0"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search player name"
                  value={searchQuery}
                />
                {normalizedSearchQuery ? (
                  searchResults.length > 0 ? (
                    <div className="space-y-2">
                      {searchResults.map((slot) => (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm" key={`search-${slot.id}`}>
                          <div>
                            <p className="font-semibold">{slot.selectedPlayerName}</p>
                            <p className="text-[var(--muted)]">
                              {slot.currentOwner.name} • Pick {slot.overallPickNumber} • Round {slot.round}
                            </p>
                          </div>
                          <div className="text-right text-[var(--muted)]">
                            <p>{slot.selectedSport ? `${SPORT_EMOJIS[slot.selectedSport]} ${SPORT_LABELS[slot.selectedSport]}` : "—"}</p>
                            <p>{slot.isKeeper ? "Keeper" : "Live pick"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)]">
                      No results for <span className="font-medium">&ldquo;{searchQuery.trim()}&rdquo;</span>.
                    </div>
                  )
                ) : null}
              </div>
            </div>
            <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 md:hidden">
              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">{normalizedSearchQuery ? "Search results" : "Recent pick grid"}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {normalizedSearchQuery ? `Showing matches for "${searchQuery.trim()}".` : "Showing the last 25 live picks."}
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">{mobilePickGridSlots.length}</span>
                </div>

                {mobilePickGridSlots.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)]">
                    {normalizedSearchQuery ? "No players matched that search." : "No live picks have been entered yet."}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {mobilePickGridSlots.map((slot) => (
                      <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3" key={`mobile-grid-${slot.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold">{slot.selectedPlayerName}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {slot.currentOwner.name} • Pick {slot.overallPickNumber} • R{slot.round}.{slot.slotNumber}
                            </p>
                          </div>
                          <div className="shrink-0 text-right text-xs font-semibold text-[var(--muted)]">
                            <p>{slot.selectedSport ? `${SPORT_EMOJIS[slot.selectedSport]} ${SPORT_LABELS[slot.selectedSport]}` : "—"}</p>
                            <p className="mt-1">{slot.isKeeper ? "Keeper" : "Live"}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[var(--surface-strong)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Pick</th>
                    <th className="px-4 py-3 text-left font-semibold">Round</th>
                    <th className="px-4 py-3 text-left font-semibold">Current owner</th>
                    <th className="px-4 py-3 text-left font-semibold">Original owner</th>
                    <th className="px-4 py-3 text-left font-semibold">Player</th>
                    <th className="px-4 py-3 text-left font-semibold">Sport</th>
                    <th className="px-4 py-3 text-left font-semibold">Type</th>
                    <th className="px-4 py-3 text-left font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.slots.map((slot) => (
                    <tr className="border-t border-[var(--border)]" key={slot.id}>
                      <td className="px-4 py-3 font-semibold">{slot.overallPickNumber}</td>
                      <td className="px-4 py-3">
                        R{slot.round}.{slot.slotNumber}
                      </td>
                      <td className="px-4 py-3">
                        {slot.currentOwner.name}
                        {slot.overrideOwnerCode ? (
                          <span className="ml-2 rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">{slot.overrideOwnerCode}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">{slot.defaultOwner.name}</td>
                      <td className="px-4 py-3">{slot.selectedPlayerName ?? <span className="text-[var(--muted)]">Open</span>}</td>
                      <td className="px-4 py-3">
                        {slot.selectedSport ? `${SPORT_EMOJIS[slot.selectedSport]} ${SPORT_LABELS[slot.selectedSport]}` : "—"}
                      </td>
                      <td className="px-4 py-3">{slot.isKeeper ? "Keeper" : "Live"}</td>
                      <td className="px-4 py-3">
                        <button
                          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!slot.selectedPlayerName || slot.isKeeper}
                          onClick={() => undoPick(slot.overallPickNumber)}
                          type="button"
                        >
                          Undo
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Legend</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {SPORTS.map((entry) => (
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium" key={entry}>
              {SPORT_EMOJIS[entry]} {SPORT_LABELS[entry]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
