"use client";

import { useState } from "react";

import { DraftBoardClient } from "@/components/draft/draft-board-client";
import { DraftHistoryGrid, type DraftHistoryGridProps } from "@/components/league/draft-history-grid";
import { RosterView } from "@/components/league/roster-view";
import type { LeagueSnapshot } from "@/lib/types/draft";

type ReadOnlyLeagueViewProps = {
  draftSnapshot: LeagueSnapshot;
  draftHistory: DraftHistoryGridProps;
};

type LeagueViewTab = "tracker" | "grid" | "rosters" | "standings";

const tabs: Array<{ id: LeagueViewTab; label: string }> = [
  { id: "tracker", label: "Draft Tracker" },
  { id: "grid", label: "Grid View" },
  { id: "rosters", label: "Rosters" },
  { id: "standings", label: "Standings" },
];

export function ReadOnlyLeagueView({ draftSnapshot, draftHistory }: ReadOnlyLeagueViewProps) {
  const draftIsComplete = draftSnapshot.draftWindow.completed;
  const [activeTab, setActiveTab] = useState<LeagueViewTab>(draftIsComplete ? "grid" : "tracker");
  const visibleTabs = draftIsComplete ? tabs.filter((tab) => tab.id !== "tracker") : tabs;
  const displayedTab = draftIsComplete && activeTab === "tracker" ? "grid" : activeTab;

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
        {displayedTab === "rosters" ? <RosterView snapshot={draftSnapshot} /> : null}
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
