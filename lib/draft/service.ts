import { DraftSlot, Prisma, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { pushDraftPickWriteback } from "@/lib/import/google-sheets";
import { DraftSlotWithRelations, KeeperWithRelations, LeagueSnapshot } from "@/lib/types/draft";
import { normalizePlayerName } from "@/lib/utils/draft";
import { calculateRosterTotals, getCurrentDraftWindow, validateDraftIntegrity, validateLeagueTotals } from "@/lib/validation/draft";

export async function getLeagueSnapshot(): Promise<LeagueSnapshot> {
  const [owners, ownerCodes, rawSlots, keepers, rosterLimits, settings] = await Promise.all([
    prisma.owner.findMany({ orderBy: { name: "asc" } }),
    prisma.ownerCode.findMany({ orderBy: [{ code: "asc" }] }),
    prisma.draftSlot.findMany({
      include: {
        currentOwner: true,
        defaultOwner: true,
        selectedPlayer: true,
        keeper: true,
      },
      orderBy: { overallPickNumber: "asc" },
    }),
    prisma.keeper.findMany({
      include: { owner: true, player: true, draftSlot: true },
      orderBy: [{ sport: "asc" }, { playerName: "asc" }],
    }),
    prisma.rosterLimit.findMany({ orderBy: { sport: "asc" } }),
    prisma.leagueSettings.findFirstOrThrow(),
  ]);

  const slots = rawSlots as DraftSlotWithRelations[];
  const ownerTotals = calculateRosterTotals({
    owners,
    slots,
    limits: rosterLimits,
    expectedTotalPlayersPerOwner: settings.expectedTotalPlayersPerOwner,
  });
  const leagueTotals = validateLeagueTotals(slots, rosterLimits, ownerTotals, settings.expectedTotalPlayersPerOwner);
  const draftIntegrity = validateDraftIntegrity({
    owners,
    slots,
    expectedTotalPlayersPerOwner: settings.expectedTotalPlayersPerOwner,
  });
  const draftWindow = getCurrentDraftWindow(slots);

  return {
    owners,
    ownerCodes,
    slots,
    keepers: keepers as KeeperWithRelations[],
    rosterLimits,
    settings,
    ownerTotals,
    leagueTotals,
    draftIntegrity,
    draftWindow,
  };
}

async function upsertPlayer(tx: Prisma.TransactionClient, displayName: string, sport: Sport) {
  const normalizedName = normalizePlayerName(displayName);

  const existing = await tx.player.findUnique({
    where: { normalizedName },
  });

  if (existing) {
    if (existing.sport !== sport) {
      throw new Error(`Player "${displayName}" already exists with a different sport.`);
    }

    return existing;
  }

  return tx.player.create({
    data: {
      displayName,
      normalizedName,
      sport,
    },
  });
}

async function enforceOwnerSportLimit(
  tx: Prisma.TransactionClient,
  input: {
    ownerId: string;
    sport: Sport;
    overallPickNumberToIgnore?: number;
  },
) {
  const rosterLimit = await tx.rosterLimit.findUnique({
    where: { sport: input.sport },
  });

  if (!rosterLimit) {
    return;
  }

  const currentCount = await tx.draftSlot.count({
    where: {
      currentOwnerId: input.ownerId,
      selectedSport: input.sport,
      ...(input.overallPickNumberToIgnore
        ? {
            overallPickNumber: {
              not: input.overallPickNumberToIgnore,
            },
          }
        : {}),
    },
  });

  if (currentCount >= rosterLimit.perOwnerLimit) {
    throw new Error(`This owner is already at the ${input.sport.toLowerCase()} limit (${currentCount}/${rosterLimit.perOwnerLimit}).`);
  }
}

async function ensureDraftIntegrity(tx: Prisma.TransactionClient) {
  const [owners, slots, settings] = await Promise.all([
    tx.owner.findMany(),
    tx.draftSlot.findMany(),
    tx.leagueSettings.findFirstOrThrow(),
  ]);

  const draftIntegrity = validateDraftIntegrity({
    owners,
    slots,
    expectedTotalPlayersPerOwner: settings.expectedTotalPlayersPerOwner,
  });

  if (!draftIntegrity.isValid) {
    const details = draftIntegrity.issues
      .map(
        (issue) =>
          `${issue.ownerName} has ${issue.draftablePickCount} picks and ${issue.keeperCount} keepers ` +
          `(expected ${issue.expectedDraftablePickCount} picks, total slots ${issue.totalAssignedSlots}/${issue.expectedTotalSlots}).`,
      )
      .join(" ");

    throw new Error(`Draft integrity issue: ${details} Re-sync and resolve the mismatch before saving picks.`);
  }
}

export async function makeDraftPick(input: {
  overallPickNumber: number;
  playerName: string;
  sport: Sport;
}) {
  const slot = await prisma.$transaction(async (tx) => {
    await ensureDraftIntegrity(tx);

    const normalizedName = normalizePlayerName(input.playerName);
    const duplicate = await tx.player.findUnique({
      where: { normalizedName },
    });

    if (duplicate) {
      const duplicateSlot = await tx.draftSlot.findFirst({
        where: {
          selectedPlayerId: duplicate.id,
        },
      });

      if (duplicateSlot) {
        throw new Error(`"${input.playerName}" has already been selected.`);
      }
    }

    const slot = await tx.draftSlot.findUnique({
      where: { overallPickNumber: input.overallPickNumber },
    });

    if (!slot) {
      throw new Error("Draft slot not found.");
    }

    await enforceOwnerSportLimit(tx, {
      ownerId: slot.currentOwnerId,
      sport: input.sport,
    });

    const player = await upsertPlayer(tx, input.playerName.trim(), input.sport);

    await tx.draftSlot.update({
      where: { id: slot.id },
      data: {
        selectedPlayerId: player.id,
        selectedPlayerName: player.displayName,
        selectedSport: input.sport,
        selectedAt: new Date(),
        originalRawValue: `${input.playerName.trim()}`,
      },
    });

    await syncCurrentPick(tx);

    return slot;
  });

  await pushDraftPickWriteback(input.overallPickNumber, "draft-pick-upsert");
  return slot;
}

export async function updateDraftPick(input: {
  overallPickNumber: number;
  playerName: string;
  sport: Sport;
}) {
  const slot = await prisma.$transaction(async (tx) => {
    await ensureDraftIntegrity(tx);

    const slot = await tx.draftSlot.findUnique({
      where: { overallPickNumber: input.overallPickNumber },
    });

    if (!slot) {
      throw new Error("Draft slot not found.");
    }

    const normalizedName = normalizePlayerName(input.playerName);
    const duplicatePlayer = await tx.player.findUnique({ where: { normalizedName } });

    if (duplicatePlayer) {
      const duplicateSlot = await tx.draftSlot.findFirst({
        where: {
          overallPickNumber: { not: input.overallPickNumber },
          selectedPlayerId: duplicatePlayer.id,
        },
      });

      if (duplicateSlot) {
        throw new Error(`"${input.playerName}" has already been selected.`);
      }
    }

    await enforceOwnerSportLimit(tx, {
      ownerId: slot.currentOwnerId,
      sport: input.sport,
      overallPickNumberToIgnore: input.overallPickNumber,
    });

    const player = await upsertPlayer(tx, input.playerName.trim(), input.sport);

    await tx.draftSlot.update({
      where: { id: slot.id },
      data: {
        selectedPlayerId: player.id,
        selectedPlayerName: player.displayName,
        selectedSport: input.sport,
        selectedAt: new Date(),
        originalRawValue: `${input.playerName.trim()}`,
      },
    });

    await syncCurrentPick(tx);

    return slot;
  });

  await pushDraftPickWriteback(input.overallPickNumber, "draft-pick-upsert");
  return slot;
}

export async function undoDraftPick(overallPickNumber: number) {
  const slot = await prisma.$transaction(async (tx) => {
    const slot = await tx.draftSlot.findUnique({
      where: { overallPickNumber },
    });

    if (!slot) {
      throw new Error("Draft slot not found.");
    }

    if (slot.isKeeper) {
      throw new Error("Keeper slots cannot be cleared from the draft board.");
    }

    await tx.draftSlot.update({
      where: { id: slot.id },
      data: {
        selectedPlayerId: null,
        selectedPlayerName: null,
        selectedSport: null,
        selectedAt: null,
        originalRawValue: null,
      },
    });

    await syncCurrentPick(tx);

    return slot;
  });

  await pushDraftPickWriteback(overallPickNumber, "draft-pick-clear");
  return slot;
}

async function syncCurrentPick(tx: Prisma.TransactionClient) {
  const nextOpenSlot = await tx.draftSlot.findFirst({
    where: { selectedPlayerName: null },
    orderBy: { overallPickNumber: "asc" },
  });

  await tx.leagueSettings.updateMany({
    data: {
      currentDraftPick: nextOpenSlot?.overallPickNumber ?? null,
      currentDraftRound: nextOpenSlot?.round ?? null,
    },
  });
}

export function groupRosterBySport(slots: DraftSlotWithRelations[]) {
  return slots.reduce(
    (accumulator, slot) => {
      if (!slot.selectedSport || !slot.selectedPlayerName) {
        return accumulator;
      }

      accumulator[slot.selectedSport].push(slot);
      return accumulator;
    },
    {
      HOCKEY: [] as DraftSlotWithRelations[],
      BASEBALL: [] as DraftSlotWithRelations[],
      FOOTBALL: [] as DraftSlotWithRelations[],
      BASKETBALL: [] as DraftSlotWithRelations[],
      GOLF: [] as DraftSlotWithRelations[],
    },
  );
}

export async function getOwnerSnapshot(ownerId: string) {
  const snapshot = await getLeagueSnapshot();
  const owner = snapshot.owners.find((entry) => entry.id === ownerId);

  if (!owner) {
    return null;
  }

  const ownerSlots = snapshot.slots.filter((slot) => slot.currentOwnerId === ownerId && slot.selectedPlayerName);

  return {
    owner,
    slots: ownerSlots,
    grouped: groupRosterBySport(ownerSlots),
    totals: snapshot.ownerTotals.find((total) => total.owner.id === ownerId) ?? null,
    settings: snapshot.settings,
  };
}
