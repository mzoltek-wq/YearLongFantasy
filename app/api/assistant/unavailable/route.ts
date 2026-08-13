import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { normalizePlayerName } from "@/lib/utils/draft";

type UnavailablePlayer = {
  displayName: string;
  normalizedName: string;
  sport: string | null;
  managerName: string | null;
  round: number | null;
  overallPickNumber: number | null;
  selectionType: "KEEPER" | "DRAFTED";
  source: "draft-slot" | "draft-grid-slot";
};

function addUnavailablePlayer(playersByKey: Map<string, UnavailablePlayer>, player: UnavailablePlayer) {
  if (!player.displayName.trim()) {
    return;
  }

  const normalizedName = normalizePlayerName(player.normalizedName || player.displayName);
  if (!normalizedName) {
    return;
  }

  const key = `${normalizedName}:${player.sport ?? "UNKNOWN"}`;
  playersByKey.set(key, {
    ...player,
    normalizedName,
  });
}

export async function GET() {
  const [classicSlots, gridSlots] = await Promise.all([
    prisma.draftSlot.findMany({
      where: {
        selectedPlayerName: {
          not: null,
        },
        OR: [
          { isKeeper: true },
          { selectedPlayerId: { not: null } },
          { selectedAt: { not: null } },
        ],
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
          in: ["KEEPER", "DRAFTED"],
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

  const playersByKey = new Map<string, UnavailablePlayer>();

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
      selectionType: slot.selectionType === "KEEPER" ? "KEEPER" : "DRAFTED",
      source: "draft-grid-slot",
    });
  }

  const players = Array.from(playersByKey.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));

  return NextResponse.json({
    players,
    count: players.length,
    generatedAt: new Date().toISOString(),
  });
}
