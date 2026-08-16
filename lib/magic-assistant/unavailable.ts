import { DraftSelectionType } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { normalizePlayerName } from "@/lib/utils/draft";

import type { MagicAssistantUnavailablePlayer } from "./types";

function addUnavailablePlayer(playersByKey: Map<string, MagicAssistantUnavailablePlayer>, player: MagicAssistantUnavailablePlayer) {
  if (!player.displayName.trim()) {
    return;
  }

  const normalizedName = normalizePlayerName(player.normalizedName || player.displayName);
  if (!normalizedName) {
    return;
  }

  playersByKey.set(normalizedName, {
    ...player,
    normalizedName,
  });
}

export async function getMagicAssistantUnavailablePlayers() {
  const [classicSlots, gridSlots] = await Promise.all([
    prisma.draftSlot.findMany({
      where: {
        selectedPlayerName: {
          not: null,
        },
        OR: [{ isKeeper: true }, { selectedPlayerId: { not: null } }, { selectedAt: { not: null } }],
      },
      include: {
        currentOwner: true,
      },
      orderBy: {
        overallPickNumber: "asc",
      },
    }),
    prisma.draftGridSlot.findMany({
      where: {
        playerName: {
          not: null,
        },
        selectionType: {
          in: [DraftSelectionType.KEEPER, DraftSelectionType.DRAFTED],
        },
      },
      include: {
        currentManager: true,
        season: true,
      },
      orderBy: [
        {
          season: {
            year: "desc",
          },
        },
        {
          overallPickNumber: "asc",
        },
      ],
    }),
  ]);

  const playersByKey = new Map<string, MagicAssistantUnavailablePlayer>();

  for (const slot of classicSlots) {
    addUnavailablePlayer(playersByKey, {
      displayName: slot.selectedPlayerName ?? "",
      normalizedName: slot.selectedPlayerName ? normalizePlayerName(slot.selectedPlayerName) : "",
      sport: slot.selectedSport,
      managerName: slot.currentOwner.name,
      round: slot.round,
      overallPickNumber: slot.overallPickNumber,
      selectionType: slot.isKeeper ? "KEEPER" : "DRAFTED",
      source: "draft-slot",
    });
  }

  for (const slot of gridSlots) {
    addUnavailablePlayer(playersByKey, {
      displayName: slot.playerName ?? "",
      normalizedName: slot.playerName ? normalizePlayerName(slot.playerName) : "",
      sport: slot.sport,
      managerName: slot.currentManager.name,
      round: slot.round,
      overallPickNumber: slot.overallPickNumber,
      selectionType: slot.selectionType === DraftSelectionType.KEEPER ? "KEEPER" : "DRAFTED",
      source: "draft-grid-slot",
    });
  }

  return Array.from(playersByKey.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}
