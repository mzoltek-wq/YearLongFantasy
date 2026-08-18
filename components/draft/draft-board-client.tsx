"use client";

import { Sport } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { SPORT_EMOJIS, SPORT_LABELS, SPORTS } from "@/lib/constants/league";
import type { LeagueSnapshot } from "@/lib/types/draft";

type DraftBoardClientProps = {
  initialSnapshot: LeagueSnapshot;
  snapshotOverride?: LeagueSnapshot;
  autoRefresh?: boolean;
  mode?: "commissioner" | "tracker";
  trackerStickyClassName?: string;
  trackerStickyTop?: string;
};

type PlayerResolution = {
  playerName: string;
  matchedDisplayName: string | null;
  matches: Array<{
    id: string;
    displayName: string;
    sport: Sport;
    positions: string[];
    team: string | null;
    isTaken: boolean;
    takenSelection: PlayerTakenSelection | null;
    unavailableSelection: PlayerTakenSelection | null;
  }>;
  sport: Sport | null;
  sportSource: "player-db" | "typed-value" | "unknown";
  positions: string[];
  positionSource: "player-db" | "typed-value" | "default" | "unknown";
  team: string | null;
  warnings: string[];
  rosterWarnings: string[];
  isTaken: boolean;
  takenSelection: PlayerTakenSelection | null;
  unavailableSelection: PlayerTakenSelection | null;
};

type PlayerTakenSelection = {
  overallPickNumber: number;
  round: number;
  slotNumber: number;
  ownerName: string;
  isKeeper: boolean;
  playerName: string;
};

type PickDistance = {
  ownerId: string;
  code: string;
  ownerName: string;
  picksBeforeNext: number | null;
};

async function requestJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    cache: "no-store",
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

export function DraftBoardClient({
  initialSnapshot,
  snapshotOverride,
  autoRefresh = true,
  mode = "commissioner",
  trackerStickyClassName = "top-2",
  trackerStickyTop,
}: DraftBoardClientProps) {
  const [localSnapshot, setLocalSnapshot] = useState(initialSnapshot);
  const [playerName, setPlayerName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [playerResolution, setPlayerResolution] = useState<PlayerResolution | null>(null);
  const [editingPickNumber, setEditingPickNumber] = useState<number | null>(null);
  const [isResolvingPlayer, setIsResolvingPlayer] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ignoredPlayerWarnings, setIgnoredPlayerWarnings] = useState<string[]>([]);

  async function refresh() {
    const data = await requestJson<LeagueSnapshot>("/api/draft");
    setLocalSnapshot(data);
  }

  const snapshot = snapshotOverride ?? localSnapshot;
  const currentPick = snapshot.draftWindow.currentPick;
  const nextPick = snapshot.draftWindow.nextPick;
  const editingPick = editingPickNumber ? snapshot.slots.find((slot) => slot.overallPickNumber === editingPickNumber) ?? null : null;
  const activePick = editingPick ?? currentPick;
  const activePickNumber = activePick?.overallPickNumber ?? null;
  const takenSelection = playerResolution?.takenSelection ?? playerResolution?.unavailableSelection ?? null;
  const isPlayerUnavailable = Boolean(playerResolution?.isTaken || takenSelection);
  const generalPlayerWarnings = playerResolution?.warnings ?? [];
  const visibleGeneralPlayerWarnings = generalPlayerWarnings.filter((warning) => !ignoredPlayerWarnings.includes(warning));
  const rosterConstructionWarnings = playerResolution?.rosterWarnings ?? [];
  const hasPlayerText = playerName.trim().length > 0;
  const needsPlayerValidation = playerName.trim().length >= 2;
  const saveDisabled = !activePick || !hasPlayerText || isResolvingPlayer || isPlayerUnavailable || (needsPlayerValidation && !playerResolution);
  const isTrackerMode = mode === "tracker";
  const recentPickLimit = isTrackerMode ? 10 : 5;
  const upcomingPickLimit = isTrackerMode ? 10 : 5;
  const pickDistances = useMemo<PickDistance[]>(() => {
    if (!currentPick) {
      return [];
    }

    const openSlots = [...snapshot.slots].filter((slot) => !slot.isKeeper && !slot.selectedPlayerName).sort((left, right) => left.overallPickNumber - right.overallPickNumber);
    const currentOpenIndex = openSlots.findIndex((slot) => slot.overallPickNumber === currentPick.overallPickNumber);

    if (currentOpenIndex === -1) {
      return [];
    }

    return snapshot.owners
      .map((owner) => {
        const nextSlotIndex = openSlots.findIndex((slot, index) => index > currentOpenIndex && slot.currentOwnerId === owner.id);

        return {
          ownerId: owner.id,
          code: owner.code,
          ownerName: owner.name,
          picksBeforeNext: nextSlotIndex === -1 ? null : nextSlotIndex - currentOpenIndex,
        };
      })
      .sort((left, right) => {
        if (left.picksBeforeNext == null && right.picksBeforeNext == null) {
          return left.code.localeCompare(right.code);
        }

        if (left.picksBeforeNext == null) {
          return 1;
        }

        if (right.picksBeforeNext == null) {
          return -1;
        }

        return left.picksBeforeNext - right.picksBeforeNext || left.code.localeCompare(right.code);
      });
  }, [currentPick, snapshot.owners, snapshot.slots]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const interval = setInterval(() => {
      refresh().catch(() => null);
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  useEffect(() => {
    const trimmedPlayerName = playerName.trim();

    if (!activePickNumber || trimmedPlayerName.length < 2) {
      return;
    }

    let isCurrent = true;
    const timeout = setTimeout(() => {
      requestJson<PlayerResolution>("/api/draft/resolve-player", {
        method: "POST",
        body: JSON.stringify({
          overallPickNumber: activePickNumber,
          playerName: trimmedPlayerName,
        }),
      })
        .then((resolution) => {
          if (isCurrent) {
            setPlayerResolution(resolution);
            setIgnoredPlayerWarnings((warnings) => warnings.filter((warning) => resolution.warnings.includes(warning)));
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
  }, [activePickNumber, playerName]);

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

    if (!activePick) {
      setError("The draft is complete.");
      return;
    }

    if (isResolvingPlayer) {
      setError("Wait for player validation to finish before saving the pick.");
      return;
    }

    if (needsPlayerValidation && !playerResolution) {
      setError("Wait for player validation to finish before saving the pick.");
      return;
    }

    if (takenSelection) {
      setError(
        `${takenSelection.playerName} is already ${takenSelection.isKeeper ? "kept" : "drafted"} by ${takenSelection.ownerName} at pick ${takenSelection.overallPickNumber}.`,
      );
      return;
    }

    if (playerResolution?.isTaken) {
      setError("That player is already kept or drafted.");
      return;
    }

    try {
      await requestJson("/api/draft/picks", {
        method: editingPick ? "PUT" : "POST",
        body: JSON.stringify({
          overallPickNumber: activePick.overallPickNumber,
          playerName,
        }),
      });
      setPlayerName("");
      setPlayerResolution(null);
      setIgnoredPlayerWarnings([]);
      setEditingPickNumber(null);
      setMessage(editingPick ? `Updated pick ${activePick.overallPickNumber}.` : `Saved pick ${activePick.overallPickNumber}.`);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not save pick.");
    }
  }

  function startEditingPick(slot: LeagueSnapshot["slots"][number]) {
    setError(null);
    setMessage(null);
    setEditingPickNumber(slot.overallPickNumber);
    setPlayerName(slot.selectedPlayerName ?? "");
    setPlayerResolution(null);
    setIgnoredPlayerWarnings([]);
    setIsResolvingPlayer(Boolean(slot.selectedPlayerName));
  }

  function cancelEditingPick() {
    setEditingPickNumber(null);
    setPlayerName("");
    setPlayerResolution(null);
    setIgnoredPlayerWarnings([]);
    setIsResolvingPlayer(false);
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

  function renderPickDistanceStrip(compact = false) {
    if (pickDistances.length === 0) {
      return null;
    }

    return (
      <div className={`border-t border-[var(--border)] ${compact ? "mt-2 pt-2" : "mt-3 pt-3"}`}>
        <p className={`${compact ? "text-[10px]" : "text-xs"} font-semibold uppercase tracking-[0.22em] text-[var(--muted)]`}>Picks before next pick</p>
        <div className={`mt-2 flex flex-wrap ${compact ? "gap-1.5" : "gap-2"}`}>
          {pickDistances.map((entry) => (
            <span
              className={`rounded-full border font-semibold ${
                entry.ownerId === currentPick?.currentOwnerId
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--border)] bg-[var(--surface-strong)] text-[var(--muted)]"
              } ${compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}
              key={entry.ownerId}
              title={entry.ownerName}
            >
              {entry.ownerId === currentPick?.currentOwnerId ? "⏱️ " : ""}
              {entry.code}: {entry.picksBeforeNext ?? "--"}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={`grid gap-6 ${isTrackerMode ? "" : "xl:grid-cols-[1.15fr_2fr]"}`}>
        {!isTrackerMode ? (
          <div className="space-y-6 rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="sticky top-3 z-10 -mx-2 space-y-3 rounded-[24px] border border-[var(--border)] bg-[var(--surface)]/95 px-2 py-3 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Draft pulse</p>
            <h2 className="text-2xl font-semibold">{snapshot.draftWindow.completed ? "Draft complete" : `Pick ${currentPick?.overallPickNumber}`}</h2>
            {currentPick ? (
              <div className="space-y-1 text-sm text-[var(--muted)]">
                <p>
                  Current owner: <span className="font-semibold text-[var(--ink)]">⏱️ {currentPick.currentOwner.name}</span>
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
            {renderPickDistanceStrip()}
            {editingPick ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>
                    Editing pick <span className="font-semibold">{editingPick.overallPickNumber}</span> for <span className="font-semibold">{editingPick.currentOwner.name}</span>.
                  </p>
                  <button className="rounded-full border border-sky-200 px-3 py-1 text-xs font-semibold" onClick={cancelEditingPick} type="button">
                    Cancel edit
                  </button>
                </div>
              </div>
            ) : null}
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
                  setIsResolvingPlayer(Boolean(activePick && nextPlayerName.trim().length >= 2));
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
                  {visibleGeneralPlayerWarnings.length > 0 ? (
                    <div className={`space-y-1 rounded-xl px-3 py-2 text-xs ${isPlayerUnavailable ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
                      {visibleGeneralPlayerWarnings.map((warning) => (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" key={warning}>
                          <p>{warning}</p>
                          {!isPlayerUnavailable && warning.includes(" looks like ") ? (
                            <button
                              className="self-start rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-900 transition hover:border-amber-400"
                              onClick={() => setIgnoredPlayerWarnings((warnings) => [...new Set([...warnings, warning])])}
                              type="button"
                            >
                              Ignore warning
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {rosterConstructionWarnings.length > 0 ? (
                    <div className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
                      {rosterConstructionWarnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                  {visibleGeneralPlayerWarnings.length === 0 && rosterConstructionWarnings.length === 0 ? (
                    <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Looks eligible based on cached player data.</p>
                  ) : (
                    null
                  )}
                  {playerResolution.matches.length > 0 ? (
                    <div className="space-y-2 rounded-xl bg-white px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Possible matches</p>
                      <div className="grid gap-2">
                        {playerResolution.matches.map((match) => {
                          const matchTakenSelection = match.takenSelection ?? match.unavailableSelection;
                          const isMatchTaken = Boolean(match.isTaken || matchTakenSelection);

                          return (
                          <button
                            className={`rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed ${
                              isMatchTaken
                                ? "border-rose-200 bg-rose-50 text-rose-950"
                                : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--surface-strong)]"
                            }`}
                            disabled={isMatchTaken}
                            key={match.id}
                            onClick={() => {
                              if (isMatchTaken) {
                                return;
                              }

                              setPlayerName(match.displayName);
                              setPlayerResolution(null);
                              setIsResolvingPlayer(Boolean(activePick));
                            }}
                            type="button"
                          >
                            <span className="block font-semibold">{match.displayName}</span>
                            <span className="block text-xs text-[var(--muted)]">
                              {SPORT_EMOJIS[match.sport]} {SPORT_LABELS[match.sport]}
                              {match.positions.length > 0 ? ` • ${match.positions.join(", ")}` : ""}
                            </span>
                            {matchTakenSelection ? (
                              <span className="mt-1 block text-xs font-semibold text-rose-800">
                                Already {matchTakenSelection.isKeeper ? "kept" : "drafted"} by {matchTakenSelection.ownerName} at pick {matchTakenSelection.overallPickNumber}
                              </span>
                            ) : null}
                          </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-[var(--muted)]">Type a player name to auto-detect sport and roster eligibility.</p>
              )}
            </div>

            <button
              className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saveDisabled}
              type="submit"
            >
              {editingPick ? `Update pick ${editingPick.overallPickNumber}` : "Save current pick"}
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
              className={`sticky ${trackerStickyClassName} z-20 rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/95 px-3 py-2.5 shadow-lg shadow-slate-900/5 backdrop-blur sm:px-4 sm:py-3`}
              style={trackerStickyTop ? { top: trackerStickyTop } : undefined}
            >
              {currentPick ? (
                <div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
                    <span className="text-base font-semibold text-[var(--ink)]">
                      R{currentPick.round} · Pick {currentPick.overallPickNumber}
                    </span>
                    <span>
                      Up <span className="font-semibold text-[var(--ink)]">⏱️ {currentPick.currentOwner.name}</span>
                    </span>
                    <span className="hidden text-[var(--border)] sm:inline">/</span>
                    <span>
                      Next <span className="font-semibold text-[var(--ink)]">{nextPick?.currentOwner.name ?? "End"}</span>
                    </span>
                  </div>
                  {renderPickDistanceStrip(true)}
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
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!slot.selectedPlayerName || slot.isKeeper}
                            onClick={() => startEditingPick(slot)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!slot.selectedPlayerName || slot.isKeeper}
                            onClick={() => undoPick(slot.overallPickNumber)}
                            type="button"
                          >
                            Undo
                          </button>
                        </div>
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
