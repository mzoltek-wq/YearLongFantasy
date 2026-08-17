"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { normalizePositions } from "@/lib/roster/positions";

function rosterFeedbackPath(status: "success" | "error", message: string, returnTo: string) {
  return `${returnTo}?status=${status}&message=${encodeURIComponent(message)}`;
}

function revalidateRosterViews() {
  ["/players", "/draft", "/keepers", "/rosters", "/league-view"].forEach((path) => revalidatePath(path));
}

export async function updateRosterPlayerPositionOverride(formData: FormData) {
  const returnTo = String(formData.get("returnTo") ?? "/rosters") || "/rosters";
  let redirectPath = rosterFeedbackPath("success", "Player position override saved.", returnTo);

  try {
    const playerId = String(formData.get("playerId") ?? "");
    const rawPositions = String(formData.get("positions") ?? "");
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { sport: true, metadata: true },
    });

    if (!player) {
      throw new Error("Player not found.");
    }

    const positions = normalizePositions(player.sport, rawPositions.split(/[,\s/|]+/));

    if (positions.length === 0) {
      throw new Error("Enter at least one valid position for this player's sport.");
    }

    const currentMetadata =
      player.metadata && typeof player.metadata === "object" && !Array.isArray(player.metadata) ? (player.metadata as Record<string, unknown>) : {};

    await prisma.player.update({
      where: { id: playerId },
      data: {
        metadata: {
          ...currentMetadata,
          manualPositions: positions,
          positionOverrideSource: "manual-roster",
          positionOverrideUpdatedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    revalidateRosterViews();
  } catch (error) {
    redirectPath = rosterFeedbackPath("error", error instanceof Error ? error.message : "Could not save player position override.", returnTo);
  }

  redirect(redirectPath);
}
