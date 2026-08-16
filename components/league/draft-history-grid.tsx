"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DraftSelectionType, KeeperStatus, Sport } from "@prisma/client";

import { SPORT_EMOJIS, SPORT_LABELS } from "@/lib/constants/league";

export type DraftHistoryManager = {
  id: string;
  name: string;
  displayName: string | null;
  code: string;
};

export type DraftHistorySlot = {
  id: string;
  round: number;
  slotNumber: number;
  overallPickNumber: number;
  originalManagerId: string;
  currentManagerId: string;
  currentManagerName: string;
  currentManagerCode: string;
  playerName: string | null;
  sport: Sport | null;
  selectionType: DraftSelectionType;
  keeperStatus: KeeperStatus | null;
  source: "draft-grid" | "live-draft";
};

export type DraftHistoryGridProps = {
  availableYears: number[];
  selectedYear: number;
  seasonName: string;
  roundCount: number;
  selectedCount: number;
  tradedPickCount: number;
  managerColumns: DraftHistoryManager[];
  slots: DraftHistorySlot[];
  variant?: "full" | "compact";
};

function slotTypeLabel(slot: DraftHistorySlot) {
  if (slot.selectionType === "KEEPER") {
    return slot.keeperStatus ?? "Keeper";
  }

  if (slot.selectionType === "DRAFTED") {
    return "Draft pick";
  }

  return "Open";
}

function sportLabel(sport: Sport | null) {
  return sport ? `${SPORT_EMOJIS[sport]} ${SPORT_LABELS[sport]}` : null;
}

export function DraftHistoryGrid({
  availableYears,
  selectedYear,
  seasonName,
  roundCount,
  selectedCount,
  tradedPickCount,
  managerColumns,
  slots,
  variant = "full",
}: DraftHistoryGridProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [managerFilter, setManagerFilter] = useState("all");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const managerById = useMemo(() => new Map(managerColumns.map((manager) => [manager.id, manager])), [managerColumns]);
  const slotsByRoundAndOriginalManager = useMemo(() => {
    const map = new Map<string, DraftHistorySlot>();
    for (const slot of slots) {
      map.set(`${slot.round}:${slot.originalManagerId}`, slot);
    }
    return map;
  }, [slots]);

  const filteredSlots = useMemo(() => {
    return slots.filter((slot) => {
      const matchesManager = managerFilter === "all" || slot.currentManagerId === managerFilter || slot.originalManagerId === managerFilter;
      const searchHaystack = [
        slot.playerName,
        slot.currentManagerName,
        slot.currentManagerCode,
        managerById.get(slot.originalManagerId)?.name,
        managerById.get(slot.originalManagerId)?.code,
        sportLabel(slot.sport),
        slot.keeperStatus,
        `round ${slot.round}`,
        `pick ${slot.overallPickNumber}`,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !normalizedSearchQuery || searchHaystack.includes(normalizedSearchQuery);

      return matchesManager && matchesSearch;
    });
  }, [managerById, managerFilter, normalizedSearchQuery, slots]);

  const selectedFilteredSlots = filteredSlots.filter((slot) => slot.playerName);

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Draft history</p>
            <h2 className="mt-2 text-3xl font-semibold">{seasonName} draft grid</h2>
            {variant === "full" ? (
              <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
                Searchable grid for traded picks, keepers, and draft picks. The 2026 view also reflects live draft selections as they are entered.
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Rounds</p>
              <p className="text-xl font-semibold">{roundCount}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Selected</p>
              <p className="text-xl font-semibold">{selectedCount}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Moved</p>
              <p className="text-xl font-semibold">{tradedPickCount}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[160px_220px_1fr]">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Year</span>
            <select
              className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
              onChange={(event) => router.push(`/league/${event.target.value}/grid`)}
              value={selectedYear}
            >
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Owner</span>
            <select className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3" onChange={(event) => setManagerFilter(event.target.value)} value={managerFilter}>
              <option value="all">All owners</option>
              {managerColumns.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.displayName ?? manager.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Search</span>
            <input
              className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search player, owner, sport, round, pick, K1/K2/K3/K4"
              value={searchQuery}
            />
          </label>
        </div>
      </div>

      <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Filtered results</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {selectedFilteredSlots.length} selected player{selectedFilteredSlots.length === 1 ? "" : "s"} match the current filters.
            </p>
          </div>
          {(normalizedSearchQuery || managerFilter !== "all") && (
            <button
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"
              onClick={() => {
                setSearchQuery("");
                setManagerFilter("all");
              }}
              type="button"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:hidden">
          {selectedFilteredSlots.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)]">
              No drafted or kept players match those filters.
            </div>
          ) : (
            selectedFilteredSlots.slice(0, 80).map((slot) => (
              <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3" key={`mobile-${slot.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{slot.playerName}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {slot.currentManagerName} · Round {slot.round} · Pick {slot.overallPickNumber}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-[var(--muted)]">
                    <p>{sportLabel(slot.sport) ?? "No sport"}</p>
                    <p className="mt-1 rounded-full bg-[var(--surface-strong)] px-2 py-0.5 font-semibold">{slotTypeLabel(slot)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[var(--surface-strong)]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Player</th>
                <th className="px-4 py-3 text-left font-semibold">Owner</th>
                <th className="px-4 py-3 text-left font-semibold">Round</th>
                <th className="px-4 py-3 text-left font-semibold">Pick</th>
                <th className="px-4 py-3 text-left font-semibold">Sport</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {selectedFilteredSlots.length === 0 ? (
                <tr>
                  <td className="border-t border-[var(--border)] px-4 py-4 text-[var(--muted)]" colSpan={6}>
                    No drafted or kept players match those filters.
                  </td>
                </tr>
              ) : (
                selectedFilteredSlots.map((slot) => (
                  <tr className="border-t border-[var(--border)]" key={`result-${slot.id}`}>
                    <td className="px-4 py-3 font-semibold">{slot.playerName}</td>
                    <td className="px-4 py-3">{slot.currentManagerName}</td>
                    <td className="px-4 py-3">{slot.round}</td>
                    <td className="px-4 py-3">{slot.overallPickNumber}</td>
                    <td className="px-4 py-3">{sportLabel(slot.sport) ?? "—"}</td>
                    <td className="px-4 py-3">{slotTypeLabel(slot)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {variant === "full" ? (
      <div className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Full draft grid</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Best on tablet/desktop. Mobile users should use the filters above.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--surface-strong)] text-left">
                <th className="sticky left-0 z-20 border-b border-r border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 font-semibold">Round</th>
                {managerColumns.map((manager) => (
                  <th className="min-w-56 border-b border-r border-[var(--border)] px-4 py-3 font-semibold" key={manager.id}>
                    <div>{manager.displayName ?? manager.name}</div>
                    <div className="text-xs font-medium text-[var(--muted)]">{manager.code}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: roundCount }, (_, index) => index + 1).map((round) => (
                <tr className="align-top" key={round}>
                  <th className="sticky left-0 z-10 border-b border-r border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-left font-semibold">{round}</th>
                  {managerColumns.map((manager) => {
                    const slot = slotsByRoundAndOriginalManager.get(`${round}:${manager.id}`);

                    if (!slot) {
                      return (
                        <td className="border-b border-r border-[var(--border)] px-4 py-4 text-[var(--muted)]" key={manager.id}>
                          Missing slot
                        </td>
                      );
                    }

                    const hasPickMoved = slot.currentManagerId !== slot.originalManagerId;

                    return (
                      <td className="border-b border-r border-[var(--border)] px-4 py-4" key={slot.id}>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[var(--muted)]">Pick {slot.overallPickNumber}</span>
                            {hasPickMoved ? <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">{slot.currentManagerCode}</span> : null}
                          </div>

                          {slot.playerName ? (
                            <div>
                              <p className="font-semibold">{slot.playerName}</p>
                              <p className="text-xs text-[var(--muted)]">{[sportLabel(slot.sport), slotTypeLabel(slot)].filter(Boolean).join(" · ")}</p>
                            </div>
                          ) : (
                            <p className="text-[var(--muted)]">{hasPickMoved ? `${slot.currentManagerName} owns this pick` : "Open"}</p>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}
    </div>
  );
}
