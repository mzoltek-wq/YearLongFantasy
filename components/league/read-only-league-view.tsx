"use client";

import { Sport } from "@prisma/client";
import { useState } from "react";

import { DraftBoardClient } from "@/components/draft/draft-board-client";
import { DraftHistoryGrid, type DraftHistoryGridProps } from "@/components/league/draft-history-grid";
import { SPORT_EMOJIS, SPORT_LABELS, SPORTS } from "@/lib/constants/league";
import type { LeagueSnapshot } from "@/lib/types/draft";

type ReadOnlyLeagueViewProps = {
  draftSnapshot: LeagueSnapshot;
  draftHistory: DraftHistoryGridProps;
};

type LeagueViewTab = "tracker" | "grid" | "rosters" | "standings";
type RosterSort = "name" | "draft";

const tabs: Array<{ id: LeagueViewTab; label: string }> = [
  { id: "tracker", label: "Draft Tracker" },
  { id: "grid", label: "Grid View" },
  { id: "rosters", label: "Rosters" },
  { id: "standings", label: "Standings" },
];

export function ReadOnlyLeagueView({ draftSnapshot, draftHistory }: ReadOnlyLeagueViewProps) {
  const draftIsComplete = draftSnapshot.draftWindow.completed;
  const [activeTab, setActiveTab] = useState<LeagueViewTab>(draftIsComplete ? "grid" : "tracker");
  const [selectedOwnerId, setSelectedOwnerId] = useState(draftSnapshot.owners[0]?.id ?? "");
  const [selectedSport, setSelectedSport] = useState<Sport>(SPORTS[0]);
  const [rosterSort, setRosterSort] = useState<RosterSort>("name");
  const visibleTabs = draftIsComplete ? tabs.filter((tab) => tab.id !== "tracker") : tabs;
  const displayedTab = draftIsComplete && activeTab === "tracker" ? "grid" : activeTab;
  const selectedOwner = draftSnapshot.owners.find((owner) => owner.id === selectedOwnerId);
  const selectedRoster = draftSnapshot.slots
    .filter((slot) => slot.currentOwnerId === selectedOwnerId && slot.selectedSport === selectedSport && slot.selectedPlayerName)
    .sort((left, right) => {
      if (rosterSort === "draft") {
        return left.overallPickNumber - right.overallPickNumber;
      }

      return (left.selectedPlayerName ?? "").localeCompare(right.selectedPlayerName ?? "");
    });

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-[rgba(255,253,247,0.94)] px-3 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">Year Long Fantasy</p>
            <h1 className="text-xl font-semibold">League View</h1>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {visibleTabs.map((tab) => (
              <button
                className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                  displayedTab === tab.id
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]"
                }`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6">
        {displayedTab === "tracker" ? <DraftBoardClient initialSnapshot={draftSnapshot} mode="tracker" trackerStickyClassName="top-[7.25rem] sm:top-[7.75rem]" /> : null}
        {displayedTab === "grid" ? <DraftHistoryGrid {...draftHistory} variant="compact" /> : null}
        {displayedTab === "rosters" ? (
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
                <select
                  className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
                  onChange={(event) => setSelectedOwnerId(event.target.value)}
                  value={selectedOwnerId}
                >
                  {draftSnapshot.owners.map((owner) => (
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
        ) : null}
        {displayedTab === "standings" ? (
          <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Standings</p>
            <h2 className="mt-2 text-2xl font-semibold">Coming soon</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              This tab will become the read-only standings hub once we wire in weekly standings snapshots, first-place bonuses, and transaction fees.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
