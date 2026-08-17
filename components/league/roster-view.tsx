"use client";

import { Sport } from "@prisma/client";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { SPORT_EMOJIS, SPORT_LABELS, SPORTS } from "@/lib/constants/league";
import { evaluateRosterFit, extractPositionsFromMetadata, getRosterPositionSlots, POSITION_OPTIONS_BY_SPORT, RosterPlayer, RosterSlotAssignment } from "@/lib/roster/positions";
import type { LeagueSnapshot } from "@/lib/types/draft";
import { StatusChip } from "@/components/ui/status-chip";
import { updateRosterPlayerPositionOverride } from "@/components/league/roster-actions";

type DraftRosterPlayer = RosterPlayer & {
  draftLabel: string;
  isKeeper: boolean;
  overallPickNumber: number;
  playerId: string | null;
  round: number;
};

export function RosterView({ allowPositionOverrides = true, snapshot }: { allowPositionOverrides?: boolean; snapshot: LeagueSnapshot }) {
  const pathname = usePathname();
  const [selectedOwnerId, setSelectedOwnerId] = useState(snapshot.owners[0]?.id ?? "");
  const [selectedSport, setSelectedSport] = useState<Sport>(SPORTS[0]);
  const selectedOwner = snapshot.owners.find((owner) => owner.id === selectedOwnerId);
  const selectedOwnerTotals = snapshot.ownerTotals.find((row) => row.owner.id === selectedOwnerId);
  const selectedSportTotals = selectedOwnerTotals?.bySport[selectedSport];
  const configuredSlots = snapshot.rosterSlotTemplates[selectedSport];
  const rosterLimit = selectedSportTotals?.limit ?? getRosterPositionSlots(selectedSport, null, configuredSlots).length;
  const selectedRoster: DraftRosterPlayer[] = snapshot.slots
    .filter((slot) => slot.currentOwnerId === selectedOwnerId && slot.selectedSport === selectedSport && slot.selectedPlayerName)
    .map((slot) => ({
      id: slot.id,
      name: slot.selectedPlayerName ?? "Unknown player",
      sport: selectedSport,
      positions: slot.selectedPlayer ? extractPositionsFromMetadata(selectedSport, slot.selectedPlayer.metadata) : [],
      draftLabel: `${slot.isKeeper ? "Keeper" : "Live pick"} · R${slot.round}.${slot.slotNumber} · Pick ${slot.overallPickNumber}`,
      isKeeper: slot.isKeeper,
      overallPickNumber: slot.overallPickNumber,
      playerId: slot.selectedPlayer?.id ?? null,
      round: slot.round,
    }));
  const rosterFit = evaluateRosterFit(selectedSport, selectedRoster, rosterLimit, configuredSlots);
  const assignmentsWithLabels = labelRepeatedRosterSlots(rosterFit.assignments);
  const lineupAssignments = assignmentsWithLabels.filter((assignment) => assignment.slot !== "BENCH");
  const benchAssignments = assignmentsWithLabels.filter((assignment) => assignment.slot === "BENCH");
  const assignedPlayerIds = new Set(rosterFit.assignments.map((assignment) => assignment.player?.id).filter(Boolean));
  const missingEligibilityPlayers = selectedRoster.filter((player) => player.positions.length === 0);
  const reviewPlayers = rosterFit.unassignedPlayers.filter((player) => !assignedPlayerIds.has(player.id)) as DraftRosterPlayer[];
  const alphabeticalRoster = [...selectedRoster].sort((left, right) => left.name.localeCompare(right.name));

  return (
    <div className="space-y-5">
      <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Roster entry</p>
            <h2 className="mt-2 text-2xl font-semibold">Owner rosters</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Pick an owner and sport to see players automatically placed into ESPN-style lineup slots. Keepers and live draft picks are both pulled from the draft board.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold">
            {selectedRoster.length} player{selectedRoster.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
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
        </div>

        {selectedOwnerTotals && selectedSportTotals ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Total roster</p>
                  <p className="mt-1 text-xl font-semibold">
                    {selectedOwnerTotals.totalSelected}/{selectedOwnerTotals.totalSelected + selectedOwnerTotals.picksLeft}
                  </p>
                </div>
                <StatusChip
                  label={selectedOwnerTotals.totalStatus === "below" ? "Below" : selectedOwnerTotals.totalStatus === "exact" ? "Full" : "Over"}
                  status={selectedOwnerTotals.totalStatus}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">Below is normal during the draft. Over means this roster needs attention.</p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    {SPORT_EMOJIS[selectedSport]} {SPORT_LABELS[selectedSport]} roster size
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {selectedSportTotals.count}/{selectedSportTotals.limit}
                  </p>
                </div>
                <StatusChip
                  label={selectedSportTotals.status === "below" ? "Needs players" : selectedSportTotals.status === "exact" ? "Full" : "Over limit"}
                  status={selectedSportTotals.status}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">Named slots are filled first. Any configured extra spots become bench spots.</p>
            </div>
          </div>
        ) : null}

        {rosterFit.warnings.length > 0 ? (
          <div className="mt-5 space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {rosterFit.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)]">
          <div className="border-b border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
            <p className="font-semibold">
              {selectedOwner?.name ?? "Owner"} · {SPORT_EMOJIS[selectedSport]} {SPORT_LABELS[selectedSport]}
            </p>
          </div>
          {selectedRoster.length === 0 ? (
            <div className="px-4 py-5 text-sm text-[var(--muted)]">No players found for this owner and sport yet.</div>
          ) : (
            <div className="space-y-5 p-4">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Lineup slots</h3>
                  <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                    {lineupAssignments.filter((assignment) => assignment.player).length}/{lineupAssignments.length} filled
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {lineupAssignments.map((assignment) => (
                    <RosterSlotCard assignment={assignment} key={`${assignment.slotLabel}-${assignment.slotIndex}`} />
                  ))}
                </div>
              </section>

              {benchAssignments.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-semibold">Bench</h3>
                    <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                      {benchAssignments.filter((assignment) => assignment.player).length}/{benchAssignments.length} filled
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {benchAssignments.map((assignment) => (
                      <RosterSlotCard assignment={assignment} key={`${assignment.slotLabel}-${assignment.slotIndex}`} />
                    ))}
                  </div>
                </section>
              ) : null}

              {reviewPlayers.length > 0 || missingEligibilityPlayers.length > 0 ? (
                <section>
                  <h3 className="mb-3 font-semibold">Needs review</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(Array.from(new Map([...reviewPlayers, ...missingEligibilityPlayers].map((player) => [player.id, player])).values()) as DraftRosterPlayer[]).map((player) => (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm" key={`review-${player.id}`}>
                        <p className="font-semibold text-amber-950">{player.name}</p>
                        <p className="mt-1 text-xs text-amber-900">
                          {player.positions.length > 0 ? `Positions: ${player.positions.join(", ")}` : "Missing ESPN position eligibility."}
                        </p>
                        <p className="mt-1 text-xs text-amber-900">{player.draftLabel}</p>
                        {allowPositionOverrides && player.playerId ? (
                          <form action={updateRosterPlayerPositionOverride} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                            <input name="playerId" type="hidden" value={player.playerId} />
                            <input name="returnTo" type="hidden" value={pathname} />
                            <input
                              className="min-w-0 rounded-full border border-amber-200 bg-white px-3 py-2 text-sm outline-none ring-amber-300/40 focus:ring-4"
                              defaultValue={player.positions.join(", ")}
                              name="positions"
                              placeholder={`Set positions, like ${POSITION_OPTIONS_BY_SPORT[selectedSport].join(", ")}`}
                            />
                            <button className="rounded-full bg-amber-900 px-4 py-2 text-sm font-semibold text-white" type="submit">
                              Save positions
                            </button>
                            <p className="text-xs text-amber-900 sm:col-span-2">Valid: {POSITION_OPTIONS_BY_SPORT[selectedSport].join(", ")}</p>
                          </form>
                        ) : null}
                        {allowPositionOverrides && !player.playerId ? (
                          <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-amber-900">
                            This player is not linked to a database player yet. Add or match the player on the Players tab first.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">Alphabetical player list</summary>
                  <div className="mt-3 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
                    {alphabeticalRoster.map((player) => (
                      <div className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center" key={`alpha-${player.id}`}>
                        <div>
                          <p className="font-semibold">{player.name}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {player.positions.length > 0 ? `Positions: ${player.positions.join(", ")}` : "Positions need review"}
                          </p>
                        </div>
                        <p className="text-xs font-semibold text-[var(--muted)]">{player.draftLabel}</p>
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type LabeledRosterAssignment = RosterSlotAssignment & {
  slotIndex: number;
  slotLabel: string;
};

function labelRepeatedRosterSlots(assignments: RosterSlotAssignment[]): LabeledRosterAssignment[] {
  const totalBySlot = assignments.reduce(
    (accumulator, assignment) => accumulator.set(assignment.slot, (accumulator.get(assignment.slot) ?? 0) + 1),
    new Map<RosterSlotAssignment["slot"], number>(),
  );
  const seenBySlot = new Map<RosterSlotAssignment["slot"], number>();

  return assignments.map((assignment, index) => {
    const nextSeen = (seenBySlot.get(assignment.slot) ?? 0) + 1;
    seenBySlot.set(assignment.slot, nextSeen);

    return {
      ...assignment,
      slotIndex: index,
      slotLabel: (totalBySlot.get(assignment.slot) ?? 0) > 1 ? `${assignment.slot} ${nextSeen}` : assignment.slot,
    };
  });
}

function RosterSlotCard({ assignment }: { assignment: LabeledRosterAssignment }) {
  const player = assignment.player as DraftRosterPlayer | null;

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${player ? "border-[var(--border)] bg-white" : "border-amber-200 bg-amber-50"}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">{assignment.slotLabel}</p>
        {!player ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Open</span> : null}
      </div>
      {player ? (
        <div>
          <p className="font-semibold">{player.name}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{player.positions.length > 0 ? player.positions.join(", ") : "Positions need review"}</p>
          <p className="mt-2 text-xs font-medium text-[var(--muted)]">{player.draftLabel}</p>
        </div>
      ) : (
        <p className="text-xs text-amber-900">No eligible player assigned yet.</p>
      )}
    </div>
  );
}
