"use client";

import { useState } from "react";

import { DraftBoardClient } from "@/components/draft/draft-board-client";
import { DraftHistoryGrid, type DraftHistoryGridProps } from "@/components/league/draft-history-grid";
import type { LeagueSnapshot } from "@/lib/types/draft";

type ReadOnlyLeagueViewProps = {
  draftSnapshot: LeagueSnapshot;
  draftHistory: DraftHistoryGridProps;
};

type LeagueViewTab = "tracker" | "grid" | "standings";

const tabs: Array<{ id: LeagueViewTab; label: string }> = [
  { id: "tracker", label: "Draft Tracker" },
  { id: "grid", label: "Grid View" },
  { id: "standings", label: "Standings" },
];

export function ReadOnlyLeagueView({ draftSnapshot, draftHistory }: ReadOnlyLeagueViewProps) {
  const [activeTab, setActiveTab] = useState<LeagueViewTab>("tracker");

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-[rgba(255,253,247,0.94)] px-3 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">Year Long Fantasy</p>
            <h1 className="text-xl font-semibold">League View</h1>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {tabs.map((tab) => (
              <button
                className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                  activeTab === tab.id
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
        {activeTab === "tracker" ? <DraftBoardClient initialSnapshot={draftSnapshot} mode="tracker" /> : null}
        {activeTab === "grid" ? <DraftHistoryGrid {...draftHistory} variant="compact" /> : null}
        {activeTab === "standings" ? (
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
