"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { fetchEspnPlayerRecords } from "@/lib/players/espn";
import { importPlayerRecords, parsePlayerImportText } from "@/lib/players/import";
import { normalizePositions } from "@/lib/roster/positions";
import { normalizePlayerName } from "@/lib/utils/draft";

function playersFeedbackPath(status: "success" | "error", message: string) {
  return `/players?status=${status}&message=${encodeURIComponent(message)}`;
}

function revalidatePlayersViews() {
  ["/players", "/draft", "/keepers", "/rosters"].forEach((path) => revalidatePath(path));
}

export async function importPlayersText(formData: FormData) {
  let redirectPath = playersFeedbackPath("success", "Player import complete.");

  try {
    const input = String(formData.get("playerImportText") ?? "");
    const records = parsePlayerImportText(input, "manual-player-import");

    if (records.length === 0) {
      throw new Error("No player rows could be parsed.");
    }

    const result = await importPlayerRecords(prisma, records);

    revalidatePlayersViews();
    redirectPath = playersFeedbackPath(
      result.unresolved > 0 ? "error" : "success",
      `Imported ${result.imported} players. ${result.unresolved} row${result.unresolved === 1 ? "" : "s"} could not be read.`,
    );
  } catch (error) {
    redirectPath = playersFeedbackPath("error", error instanceof Error ? error.message : "Could not import players.");
  }

  redirect(redirectPath);
}

export async function importEspnPlayers(formData: FormData) {
  let redirectPath = playersFeedbackPath("success", "ESPN player import complete.");

  try {
    const season = Number(formData.get("season") ?? new Date().getFullYear());
    const limit = Number(formData.get("limit") ?? 2500);
    const { records, failures } = await fetchEspnPlayerRecords({ season, limit });

    if (records.length === 0) {
      throw new Error(`ESPN returned zero players. ${failures.map((failure) => `${failure.sport}: ${failure.message}`).join("; ")}`);
    }

    const result = await importPlayerRecords(prisma, records);
    const failureMessage = failures.length > 0 ? ` ${failures.length} sport request${failures.length === 1 ? "" : "s"} failed.` : "";

    revalidatePlayersViews();
    redirectPath = playersFeedbackPath("success", `Imported ${result.imported} ESPN players for ${season}.${failureMessage}`);
  } catch (error) {
    redirectPath = playersFeedbackPath("error", error instanceof Error ? error.message : "Could not import ESPN players.");
  }

  redirect(redirectPath);
}

export async function addManualPlayer(formData: FormData) {
  let redirectPath = playersFeedbackPath("success", "Manual player saved.");

  try {
    const displayName = String(formData.get("displayName") ?? "").trim();
    const sport = String(formData.get("sport") ?? "") as Sport;
    const rawPositions = String(formData.get("positions") ?? "");

    if (!displayName) {
      throw new Error("Enter a player name.");
    }

    if (!Object.values(Sport).includes(sport)) {
      throw new Error("Choose a valid sport.");
    }

    const positions = normalizePositions(sport, rawPositions.split(/[,\s/|]+/));

    if (positions.length === 0) {
      throw new Error("Enter at least one valid position for this player's sport.");
    }

    const normalizedName = normalizePlayerName(displayName);
    const existingPlayer = await prisma.player.findUnique({
      where: { normalizedName },
      select: { metadata: true },
    });
    const currentMetadata =
      existingPlayer?.metadata && typeof existingPlayer.metadata === "object" && !Array.isArray(existingPlayer.metadata)
        ? (existingPlayer.metadata as Record<string, unknown>)
        : {};

    await prisma.player.upsert({
      where: { normalizedName },
      create: {
        displayName,
        normalizedName,
        sport,
        metadata: {
          positions,
          espnPositions: positions,
          manualPositions: positions,
          espnId: null,
          source: "Manual",
          positionOverrideSource: "manual-player-add",
          positionOverrideUpdatedAt: new Date().toISOString(),
        },
      },
      update: {
        displayName,
        sport,
        metadata: {
          ...currentMetadata,
          positions,
          espnPositions: positions,
          manualPositions: positions,
          espnId: typeof currentMetadata.espnId === "string" ? currentMetadata.espnId : null,
          source: "Manual",
          positionOverrideSource: "manual-player-add",
          positionOverrideUpdatedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    revalidatePlayersViews();
  } catch (error) {
    redirectPath = playersFeedbackPath("error", error instanceof Error ? error.message : "Could not save manual player.");
  }

  redirect(redirectPath);
}

export async function updatePlayerPositionOverride(formData: FormData) {
  let redirectPath = playersFeedbackPath("success", "Player position override saved.");

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
          positionOverrideSource: "manual",
          positionOverrideUpdatedAt: new Date().toISOString(),
        },
      },
    });

    revalidatePlayersViews();
  } catch (error) {
    redirectPath = playersFeedbackPath("error", error instanceof Error ? error.message : "Could not save player position override.");
  }

  redirect(redirectPath);
}

export async function clearPlayerPositionOverride(formData: FormData) {
  let redirectPath = playersFeedbackPath("success", "Player position override cleared.");

  try {
    const playerId = String(formData.get("playerId") ?? "");
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { metadata: true },
    });

    if (!player) {
      throw new Error("Player not found.");
    }

    const currentMetadata =
      player.metadata && typeof player.metadata === "object" && !Array.isArray(player.metadata) ? (player.metadata as Record<string, unknown>) : {};
    const metadata = { ...currentMetadata };
    delete metadata.manualPositions;
    delete metadata.positionOverride;
    delete metadata.positionOverrideSource;
    delete metadata.positionOverrideUpdatedAt;

    await prisma.player.update({
      where: { id: playerId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });

    revalidatePlayersViews();
  } catch (error) {
    redirectPath = playersFeedbackPath("error", error instanceof Error ? error.message : "Could not clear player position override.");
  }

  redirect(redirectPath);
}
