"use client";

import { Sport } from "@prisma/client";
import { useState } from "react";

import { SPORT_EMOJIS, SPORT_LABELS, SPORTS } from "@/lib/constants/league";
import type { LeagueSnapshot } from "@/lib/types/draft";

type RosterSort = "name" | "draft";

export function RosterView({ snapshot }: { snapshot: LeagueSnapshot }) {
  const [selectedOwnerId, setSelectedOwnerId] = useState(snapshot.owners[0]?.id ?? "");
  const [selectedSport, setSelectedSport] = useState<Sport>(SPORTS[0]);
  const [rosterSort, setRosterSort] = useState<RosterSort>("name");
  const selectedOwner = snapshot.owners.find((owner) => owner.id === selectedOwnerId);
  const selectedRoster = snapshot.slots
    .filter((slot) => slot.currentOwnerId === selectedOwnerId && slot.selectedSport === selectedSport && slot.selectedPlayerName)
    .sort((left, right) => {
      if (rosterSort === "draft") {
        return left.overallPickNumber - right.overallPickNumber;
      }

      return (left.selectedPlayerName ?? "").localeCompare(right.selectedPlayerName ?? "");
    });

  return (
    <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Roster entry</p>
          <h2 className="mt-2 text-2xl font-semibold">Owner rosters</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Pick an owner and sport, then sort alphabetically or by draft slot for ESPN entry.</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold">
          {selectedRoster.length} player{selectedRoster.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Owner</span>
          <select className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3" onChange={(event) => setSelectedOwnerId(event.target.value)} value={selectedOwnerId}>
            {snapshot.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Sport</span>
          <select className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3" onChange={(event) => setSelectedSport(event.target.value as Sport)} value={selectedSport}>
            {SPORTS.map((sport) => (
              <option key={sport} value={sport}>
                {SPORT_EMOJIS[sport]} {SPORT_LABELS[sport]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Sort</span>
          <select className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3" onChange={(event) => setRosterSort(event.target.value as RosterSort)} value={rosterSort}>
            <option value="name">Player name A-Z</option>
            <option value="draft">Draft spot</option>
          </select>
        </label>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)]">
        <div className="border-b border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
          <p className="font-semibold">
            {selectedOwner?.name ?? "Owner"} · {SPORT_EMOJIS[selectedSport]} {SPORT_LABELS[selectedSport]}
          </p>
        </div>
        {selectedRoster.length === 0 ? (
          <div className="px-4 py-5 text-sm text-[var(--muted)]">No players found for this owner and sport yet.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {selectedRoster.map((slot) => (
              <div className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center" key={slot.id}>
                <div>
                  <p className="font-semibold">{slot.selectedPlayerName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {slot.isKeeper ? "Keeper" : "Live pick"} · Round {slot.round}, Pick {slot.overallPickNumber}
                  </p>
                </div>
                <p className="text-xs font-semibold text-[var(--muted)]">R{slot.round}.{slot.slotNumber}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
