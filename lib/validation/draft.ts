import { DraftSlot, Owner, RosterLimit, Sport } from "@prisma/client";

import { SPORTS } from "@/lib/constants/league";

export type OwnerSportStatus = "below" | "exact" | "over";

export type OwnerTotals = {
  owner: Owner;
  totalSelected: number;
  picksLeft: number;
  bySport: Record<Sport, { count: number; limit: number; status: OwnerSportStatus }>;
  totalStatus: OwnerSportStatus;
};

export type DraftIntegrityIssue = {
  ownerName: string;
  keeperCount: number;
  totalAssignedSlots: number;
  expectedTotalSlots: number;
  draftablePickCount: number;
  expectedDraftablePickCount: number;
};

type LeagueSlot = DraftSlot & {
  currentOwner: Owner;
};

export function calculateRosterTotals({
  owners,
  slots,
  limits,
  expectedTotalPlayersPerOwner,
}: {
  owners: Owner[];
  slots: LeagueSlot[];
  limits: RosterLimit[];
  expectedTotalPlayersPerOwner: number | null;
}) {
  const limitMap = new Map(limits.map((limit) => [limit.sport, limit]));

  return owners.map((owner) => {
    const ownerSlots = slots.filter((slot) => slot.currentOwnerId === owner.id && slot.selectedSport);
    const totalSelected = ownerSlots.length;
    const picksLeft = Math.max((expectedTotalPlayersPerOwner ?? totalSelected) - totalSelected, 0);

    const bySport = SPORTS.reduce((accumulator, sport) => {
      const count = ownerSlots.filter((slot) => slot.selectedSport === sport).length;
      const limit = limitMap.get(sport)?.perOwnerLimit ?? 0;
      let status: OwnerSportStatus = "below";

      if (count === limit) {
        status = "exact";
      } else if (count > limit) {
        status = "over";
      }

      accumulator[sport] = { count, limit, status };
      return accumulator;
    }, {} as OwnerTotals["bySport"]);

    const totalStatus: OwnerSportStatus =
      expectedTotalPlayersPerOwner == null
        ? "exact"
        : totalSelected < expectedTotalPlayersPerOwner
          ? "below"
          : totalSelected === expectedTotalPlayersPerOwner
            ? "exact"
            : "over";

    return {
      owner,
      totalSelected,
      picksLeft,
      bySport,
      totalStatus,
    };
  });
}

export function validateLeagueTotals(slots: DraftSlot[], limits: RosterLimit[], ownerTotals: OwnerTotals[], expectedTotalPlayersPerOwner: number | null) {
  const ownerCount = ownerTotals.length;
  const bySport = SPORTS.map((sport) => {
    const drafted = slots.filter((slot) => slot.selectedSport === sport).length;
    const perOwnerLimit = limits.find((limit) => limit.sport === sport)?.perOwnerLimit ?? 0;
    const target = perOwnerLimit * ownerCount;
    const status: OwnerSportStatus = drafted < target ? "below" : drafted === target ? "exact" : "over";

    return {
      sport,
      drafted,
      target,
      status,
    };
  });

  const ownerOverages = ownerTotals.flatMap((total) =>
    SPORTS.filter((sport) => total.bySport[sport].status === "over").map((sport) => ({
      ownerName: total.owner.name,
      sport,
      count: total.bySport[sport].count,
      limit: total.bySport[sport].limit,
    })),
  );

  const missingCounts = ownerTotals.flatMap((total) =>
    SPORTS.filter((sport) => total.bySport[sport].status === "below").map((sport) => ({
      ownerName: total.owner.name,
      sport,
      count: total.bySport[sport].count,
      limit: total.bySport[sport].limit,
    })),
  );

  const totalSizeIssues =
    expectedTotalPlayersPerOwner == null
      ? []
      : ownerTotals
          .filter((total) => total.totalSelected !== expectedTotalPlayersPerOwner)
          .map((total) => ({
            ownerName: total.owner.name,
            totalSelected: total.totalSelected,
            expected: expectedTotalPlayersPerOwner,
          }));

  return {
    bySport,
    ownerOverages,
    missingCounts,
    totalSizeIssues,
  };
}

export function getCurrentDraftWindow<T extends DraftSlot>(slots: T[]) {
  const liveDraftQueue = [...slots]
    .filter((slot) => !slot.isKeeper && !slot.selectedPlayerName)
    .sort((a, b) => a.overallPickNumber - b.overallPickNumber);
  const currentPick = liveDraftQueue[0] ?? null;
  const nextPick = liveDraftQueue[1] ?? null;

  return {
    currentPick,
    nextPick,
    completed: !currentPick,
  };
}

export function validateDraftIntegrity({
  owners,
  slots,
  expectedTotalPlayersPerOwner,
}: {
  owners: Owner[];
  slots: DraftSlot[];
  expectedTotalPlayersPerOwner: number | null;
}) {
  if (expectedTotalPlayersPerOwner == null) {
    return {
      isValid: true,
      issues: [] as DraftIntegrityIssue[],
    };
  }

  const issues = owners
    .map((owner) => {
      const ownerSlots = slots.filter((slot) => slot.currentOwnerId === owner.id);
      const keeperCount = ownerSlots.filter((slot) => slot.isKeeper).length;
      const totalAssignedSlots = ownerSlots.length;
      const draftablePickCount = ownerSlots.filter((slot) => !slot.isKeeper).length;
      const expectedDraftablePickCount = Math.max(expectedTotalPlayersPerOwner - keeperCount, 0);

      if (totalAssignedSlots === expectedTotalPlayersPerOwner && draftablePickCount === expectedDraftablePickCount) {
        return null;
      }

      return {
        ownerName: owner.name,
        keeperCount,
        totalAssignedSlots,
        expectedTotalSlots: expectedTotalPlayersPerOwner,
        draftablePickCount,
        expectedDraftablePickCount,
      };
    })
    .filter((issue): issue is DraftIntegrityIssue => Boolean(issue));

  return {
    isValid: issues.length === 0,
    issues,
  };
}
