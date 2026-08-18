import { DraftSelectionType, DraftSlot, Player, Prisma, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { pushDraftPickWriteback } from "@/lib/import/google-sheets";
import { buildPlayerMetadata, findExistingDraftSelection, findSimilarDraftSelection, resolveDraftPlayer } from "@/lib/players/resolve";
import { extractPositionsFromMetadata } from "@/lib/roster/positions";
import { getRosterSlotSettings } from "@/lib/roster/settings";
import { DraftSlotWithRelations, KeeperWithRelations, LeagueSnapshot } from "@/lib/types/draft";
import { normalizePlayerName } from "@/lib/utils/draft";
import { calculateRosterTotals, getCurrentDraftWindow, validateDraftIntegrity, validateLeagueTotals } from "@/lib/validation/draft";

const CURRENT_DRAFT_GRID_YEAR = 2026;

function normalizePersonKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export async function getLeagueSnapshot(): Promise<LeagueSnapshot> {
  const [leagueData, rosterSlotTemplates] = await Promise.all([
    prisma.$transaction([
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
    ]),
    getRosterSlotSettings(),
  ]);
  const [owners, ownerCodes, rawSlots, keepers, rosterLimits, settings] = leagueData;

  const slots = await enrichDraftSlotsWithCurrentPlayerEligibility(rawSlots as DraftSlotWithRelations[]);
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
    rosterSlotTemplates,
    settings,
    ownerTotals,
    leagueTotals,
    draftIntegrity,
    draftWindow,
  };
}

function slotHasPositionEligibility(slot: DraftSlotWithRelations) {
  if (!slot.selectedSport || !slot.selectedPlayer) {
    return false;
  }

  return extractPositionsFromMetadata(slot.selectedSport, slot.selectedPlayer.metadata).length > 0;
}

async function enrichDraftSlotsWithCurrentPlayerEligibility(slots: DraftSlotWithRelations[]) {
  const slotsNeedingPlayerEligibility = slots.filter((slot) => slot.selectedPlayerName && slot.selectedSport && !slotHasPositionEligibility(slot));

  if (slotsNeedingPlayerEligibility.length === 0) {
    return slots;
  }

  const normalizedNames = Array.from(new Set(slotsNeedingPlayerEligibility.map((slot) => normalizePlayerName(slot.selectedPlayerName ?? "")).filter(Boolean)));
  const exactPlayers = await prisma.player.findMany({
    where: {
      normalizedName: {
        in: normalizedNames,
      },
    },
  });
  const exactPlayerByKey = new Map(
    exactPlayers
      .filter((player) => extractPositionsFromMetadata(player.sport, player.metadata).length > 0)
      .map((player) => [`${player.sport}:${player.normalizedName}`, player]),
  );
  const enrichedSlots = slots.map((slot) => {
    if (!slot.selectedPlayerName || !slot.selectedSport || slotHasPositionEligibility(slot)) {
      return slot;
    }

    const exactPlayer = exactPlayerByKey.get(`${slot.selectedSport}:${normalizePlayerName(slot.selectedPlayerName)}`);
    return exactPlayer ? { ...slot, selectedPlayer: exactPlayer } : slot;
  });
  const fuzzyTargets = enrichedSlots.filter((slot) => slot.selectedPlayerName && slot.selectedSport && !slotHasPositionEligibility(slot));
  const fuzzyPlayersByKey = new Map<string, Player | null>();

  await Promise.all(
    fuzzyTargets.map(async (slot) => {
      const normalizedName = normalizePlayerName(slot.selectedPlayerName ?? "");
      const key = `${slot.selectedSport}:${normalizedName}`;

      if (fuzzyPlayersByKey.has(key)) {
        return;
      }

      const lastToken = normalizedName.split(/\s+/).filter(Boolean).at(-1);
      if (!lastToken || lastToken.length < 4) {
        fuzzyPlayersByKey.set(key, null);
        return;
      }

      const candidates = await prisma.player.findMany({
        where: {
          sport: slot.selectedSport!,
          normalizedName: {
            contains: lastToken,
          },
        },
        take: 25,
      });
      const match =
        candidates
          .filter((player) => extractPositionsFromMetadata(player.sport, player.metadata).length > 0)
          .map((player) => ({
            player,
            distance: playerNameDistance(normalizedName, player.normalizedName),
          }))
          .filter((candidate) => isLikelySamePlayerName(normalizedName, candidate.player.normalizedName, candidate.distance))
          .sort((left, right) => left.distance - right.distance)[0]?.player ?? null;

      fuzzyPlayersByKey.set(key, match);
    }),
  );

  return enrichedSlots.map((slot) => {
    if (!slot.selectedPlayerName || !slot.selectedSport || slotHasPositionEligibility(slot)) {
      return slot;
    }

    const match = fuzzyPlayersByKey.get(`${slot.selectedSport}:${normalizePlayerName(slot.selectedPlayerName)}`);
    return match ? { ...slot, selectedPlayer: match } : slot;
  });
}

function playerNameDistance(left: string, right: string) {
  return levenshteinDistance(compactPlayerName(left), compactPlayerName(right));
}

function isLikelySamePlayerName(left: string, right: string, distance: number) {
  const shorterLength = Math.min(compactPlayerName(left).length, compactPlayerName(right).length);

  if (shorterLength < 8) {
    return distance <= 1;
  }

  if (distance <= 2 && shorterLength <= 14) {
    return true;
  }

  return distance <= 3 && lastTokenDistance(left, right) <= 2;
}

function compactPlayerName(value: string) {
  return value.replace(/[^a-z0-9]/gi, "");
}

function lastTokenDistance(left: string, right: string) {
  const leftLast = left.split(/\s+/).filter(Boolean).at(-1) ?? "";
  const rightLast = right.split(/\s+/).filter(Boolean).at(-1) ?? "";

  if (!leftLast || !rightLast) {
    return Number.POSITIVE_INFINITY;
  }

  return levenshteinDistance(leftLast, rightLast);
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, previous[rightIndex - 1] + cost);
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

async function upsertPlayer(tx: Prisma.TransactionClient, displayName: string, sport: Sport, metadata?: Prisma.InputJsonValue) {
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
      metadata,
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

async function enforcePlayerAvailability(
  tx: Prisma.TransactionClient,
  input: {
    playerId?: string | null;
    playerName: string;
    sport?: Sport | null;
    overallPickNumberToIgnore?: number;
  },
) {
  const existingSelection = await findExistingDraftSelection({
    playerId: input.playerId,
    normalizedName: normalizePlayerName(input.playerName),
    overallPickNumberToIgnore: input.overallPickNumberToIgnore,
    tx,
  });

  if (existingSelection) {
    throw new Error(
      `"${existingSelection.playerName}" is already ${existingSelection.isKeeper ? "kept" : "drafted"} by ${existingSelection.ownerName} at pick ${existingSelection.overallPickNumber}.`,
    );
  }

  // Similar-name matches are advisory only. Exact duplicate checks above still
  // block, but players like Jalen Brunson should not be stopped by Jalen Johnson.
}

async function findManagerForOwner(tx: Prisma.TransactionClient, ownerId: string) {
  const owner = await tx.owner.findUnique({
    where: { id: ownerId },
  });

  if (!owner) {
    return null;
  }

  const managers = await tx.manager.findMany();
  const ownerNameKey = normalizePersonKey(owner.name);

  return (
    managers.find((manager) => manager.code.toUpperCase() === owner.code.toUpperCase()) ??
    managers.find((manager) => normalizePersonKey(manager.name) === ownerNameKey || normalizePersonKey(manager.displayName ?? "") === ownerNameKey) ??
    managers.find((manager) => normalizePersonKey(manager.name).startsWith(ownerNameKey) || ownerNameKey.startsWith(normalizePersonKey(manager.name))) ??
    managers.find((manager) => {
      const displayKey = normalizePersonKey(manager.displayName ?? "");
      return Boolean(displayKey) && (displayKey.startsWith(ownerNameKey) || ownerNameKey.startsWith(displayKey));
    }) ??
    null
  );
}

async function syncDraftGridSlotFromDraftSlot({
  tx,
  slot,
  playerId,
  playerName,
  sport,
  selectionType,
  originalRawValue,
  selectedAt,
}: {
  tx: Prisma.TransactionClient;
  slot: Pick<DraftSlot, "overallPickNumber" | "currentOwnerId">;
  playerId: string | null;
  playerName: string | null;
  sport: Sport | null;
  selectionType: DraftSelectionType;
  originalRawValue: string | null;
  selectedAt: Date | null;
}) {
  const [season, currentManager] = await Promise.all([
    tx.leagueSeason.findFirst({
      where: { year: CURRENT_DRAFT_GRID_YEAR },
      include: {
        drafts: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    }),
    findManagerForOwner(tx, slot.currentOwnerId),
  ]);
  const draft = season?.drafts[0];

  if (!draft || !currentManager) {
    return;
  }

  await tx.draftGridSlot.updateMany({
    where: {
      draftId: draft.id,
      overallPickNumber: slot.overallPickNumber,
    },
    data: {
      currentManagerId: currentManager.id,
      playerId,
      playerName,
      sport,
      selectionType,
      keeperStatus: null,
      rawCellValue: originalRawValue,
      selectedAt,
    },
  });
}

export async function makeDraftPick(input: {
  overallPickNumber: number;
  playerName: string;
  sport?: Sport;
}) {
  const slot = await prisma.$transaction(async (tx) => {
    const resolution = await resolveDraftPlayer(input.playerName, tx);
    const sport = input.sport ?? resolution.sport;

    if (!sport) {
      throw new Error(`Could not determine "${input.playerName}" sport. Add it to the player database or type a sport token like MLB, NBA, NHL, NFL, or PGA.`);
    }

    const playerName = resolution.matchedDisplayName ?? resolution.playerName;
    const normalizedName = normalizePlayerName(playerName);
    const duplicate = await tx.player.findUnique({
      where: { normalizedName },
    });
    await enforcePlayerAvailability(tx, {
      playerId: duplicate?.id ?? resolution.matchedPlayerId,
      playerName,
      sport,
    });

    const slot = await tx.draftSlot.findUnique({
      where: { overallPickNumber: input.overallPickNumber },
    });

    if (!slot) {
      throw new Error("Draft slot not found.");
    }

    await enforceOwnerSportLimit(tx, {
      ownerId: slot.currentOwnerId,
      sport,
    });

    const player = await upsertPlayer(
      tx,
      playerName.trim(),
      sport,
      buildPlayerMetadata({
        positions: resolution.positions,
        team: resolution.team,
        source: resolution.matchedPlayerId ? "player-db" : "draft-entry",
      }) as Prisma.InputJsonValue,
    );
    const selectedAt = new Date();
    const originalRawValue = input.playerName.trim();

    await tx.draftSlot.update({
      where: { id: slot.id },
      data: {
        selectedPlayerId: player.id,
        selectedPlayerName: player.displayName,
        selectedSport: sport,
        selectedAt,
        originalRawValue,
      },
    });
    await syncDraftGridSlotFromDraftSlot({
      tx,
      slot,
      playerId: player.id,
      playerName: player.displayName,
      sport,
      selectionType: DraftSelectionType.DRAFTED,
      originalRawValue,
      selectedAt,
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
  sport?: Sport;
}) {
  const slot = await prisma.$transaction(async (tx) => {
    const slot = await tx.draftSlot.findUnique({
      where: { overallPickNumber: input.overallPickNumber },
    });

    if (!slot) {
      throw new Error("Draft slot not found.");
    }

    if (slot.isKeeper) {
      throw new Error("Keeper slots cannot be edited from the draft board.");
    }

    const resolution = await resolveDraftPlayer(input.playerName, tx);
    const sport = input.sport ?? resolution.sport;

    if (!sport) {
      throw new Error(`Could not determine "${input.playerName}" sport. Add it to the player database or type a sport token like MLB, NBA, NHL, NFL, or PGA.`);
    }

    const playerName = resolution.matchedDisplayName ?? resolution.playerName;
    const normalizedName = normalizePlayerName(playerName);
    const duplicatePlayer = await tx.player.findUnique({ where: { normalizedName } });
    await enforcePlayerAvailability(tx, {
      playerId: duplicatePlayer?.id ?? resolution.matchedPlayerId,
      playerName,
      sport,
      overallPickNumberToIgnore: input.overallPickNumber,
    });

    await enforceOwnerSportLimit(tx, {
      ownerId: slot.currentOwnerId,
      sport,
      overallPickNumberToIgnore: input.overallPickNumber,
    });

    const player = await upsertPlayer(
      tx,
      playerName.trim(),
      sport,
      buildPlayerMetadata({
        positions: resolution.positions,
        team: resolution.team,
        source: resolution.matchedPlayerId ? "player-db" : "draft-entry",
      }) as Prisma.InputJsonValue,
    );
    const selectedAt = new Date();
    const originalRawValue = input.playerName.trim();

    await tx.draftSlot.update({
      where: { id: slot.id },
      data: {
        selectedPlayerId: player.id,
        selectedPlayerName: player.displayName,
        selectedSport: sport,
        selectedAt,
        originalRawValue,
      },
    });
    await syncDraftGridSlotFromDraftSlot({
      tx,
      slot,
      playerId: player.id,
      playerName: player.displayName,
      sport,
      selectionType: DraftSelectionType.DRAFTED,
      originalRawValue,
      selectedAt,
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
    await syncDraftGridSlotFromDraftSlot({
      tx,
      slot,
      playerId: null,
      playerName: null,
      sport: null,
      selectionType: DraftSelectionType.OPEN,
      originalRawValue: null,
      selectedAt: null,
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
