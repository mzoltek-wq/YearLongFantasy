"use client";

import { Sport } from "@prisma/client";
import { useMemo, useState } from "react";

import { SPORTS, SPORT_EMOJIS, SPORT_LABELS } from "@/lib/constants/league";

export type PlayerBrowserRow = {
  id: string;
  displayName: string;
  sport: Sport;
  positions: string[];
  team: string | null;
  espnId: string | null;
  source: string | null;
  updatedAt: string;
};

type PlayerBrowserProps = {
  players: PlayerBrowserRow[];
};

export function PlayerBrowser({ players }: PlayerBrowserProps) {
  const [sportFilter, setSportFilter] = useState<"ALL" | Sport>("ALL");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const availablePositions = useMemo(() => {
    const positions = new Set<string>();
    players
      .filter((player) => sportFilter === "ALL" || player.sport === sportFilter)
      .forEach((player) => player.positions.forEach((position) => positions.add(position)));

    return Array.from(positions).sort((left, right) => left.localeCompare(right));
  }, [players, sportFilter]);

  const filteredPlayers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return players
      .filter((player) => sportFilter === "ALL" || player.sport === sportFilter)
      .filter((player) => positionFilter === "ALL" || player.positions.includes(positionFilter))
      .filter((player) => {
        if (!normalizedSearch) {
          return true;
        }

        return [player.displayName, player.team, player.espnId, player.source, ...player.positions].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
      })
      .slice(0, 500);
  }, [players, positionFilter, search, sportFilter]);

  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="border-b border-[var(--border)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[var(--muted)]">Player database</p>
            <h2 className="mt-2 text-2xl font-semibold">Browse cached player eligibility</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {players.length} players stored. The draft form uses this same data to auto-detect sport and position eligibility.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[620px]">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Sport</span>
              <select
                className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
                onChange={(event) => {
                  setSportFilter(event.target.value as "ALL" | Sport);
                  setPositionFilter("ALL");
                }}
                value={sportFilter}
              >
                <option value="ALL">All sports</option>
                {SPORTS.map((sport) => (
                  <option key={sport} value={sport}>
                    {SPORT_EMOJIS[sport]} {SPORT_LABELS[sport]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium">Position</span>
              <select className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3" onChange={(event) => setPositionFilter(event.target.value)} value={positionFilter}>
                <option value="ALL">All positions</option>
                {availablePositions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium">Search</span>
              <input className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3" onChange={(event) => setSearch(event.target.value)} placeholder="Player, team, ESPN ID" value={search} />
            </label>
          </div>
        </div>
      </div>

      <div className="p-4 md:hidden">
        <div className="space-y-3">
          {filteredPlayers.map((player) => (
            <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3" key={player.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{player.displayName}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {SPORT_EMOJIS[player.sport]} {SPORT_LABELS[player.sport]} {player.team ? `• ${player.team}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--surface-strong)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">{player.positions.join(", ") || "No pos"}</span>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {player.source ?? "Unknown source"} {player.espnId ? `• ESPN ${player.espnId}` : ""}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-[var(--surface-strong)]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Player</th>
              <th className="px-4 py-3 text-left font-semibold">Sport</th>
              <th className="px-4 py-3 text-left font-semibold">Positions</th>
              <th className="px-4 py-3 text-left font-semibold">Team</th>
              <th className="px-4 py-3 text-left font-semibold">ESPN ID</th>
              <th className="px-4 py-3 text-left font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.map((player) => (
              <tr className="border-t border-[var(--border)]" key={player.id}>
                <td className="px-4 py-3 font-semibold">{player.displayName}</td>
                <td className="px-4 py-3">
                  {SPORT_EMOJIS[player.sport]} {SPORT_LABELS[player.sport]}
                </td>
                <td className="px-4 py-3">{player.positions.join(", ") || "Needs position"}</td>
                <td className="px-4 py-3">{player.team ?? "—"}</td>
                <td className="px-4 py-3">{player.espnId ?? "—"}</td>
                <td className="px-4 py-3">{player.source ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredPlayers.length === 0 ? <div className="border-t border-[var(--border)] px-6 py-8 text-sm text-[var(--muted)]">No players match those filters yet.</div> : null}
    </section>
  );
}
