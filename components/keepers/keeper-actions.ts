"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { parseKeeperText } from "@/lib/keepers/import";
import { buildSnakeDraftOrder, normalizePlayerName } from "@/lib/utils/draft";

function revalidateKeeperViews() {
  ["/keepers", "/draft", "/tracker", "/dashboard", "/owners", "/admin"].forEach((path) => revalidatePath(path));
}

function redirectWithKeeperFeedback(status: "success" | "error", message: string) {
  redirect(`/keepers?status=${status}&message=${encodeURIComponent(message)}`);
}

export async function updateDraftOrder(formData: FormData) {
  try {
    const order = Array.from({ length: 10 }, (_, index) => String(formData.get(`owner-${index}`) ?? "")).filter(Boolean);
    const uniqueOwnerIds = new Set(order);

    if (order.length !== 10 || uniqueOwnerIds.size !== 10) {
      throw new Error("Draft order must include all 10 owners exactly once.");
    }

    const rosterLimits = await prisma.rosterLimit.findMany();
    const totalRounds = rosterLimits.reduce((total, limit) => total + limit.perOwnerLimit, 0);

    if (totalRounds <= 0) {
      throw new Error("Roster sizes must be set before saving draft order.");
    }

    const slots = buildSnakeDraftOrder(order, totalRounds);

    await prisma.$transaction([
      prisma.keeper.deleteMany(),
      prisma.draftSlot.deleteMany(),
      prisma.draftSlot.createMany({
        data: slots.map((slot) => ({
          round: slot.round,
          slotNumber: slot.slotNumber,
          overallPickNumber: slot.overallPickNumber,
          defaultOwnerId: slot.ownerId,
          currentOwnerId: slot.ownerId,
        })),
      }),
      prisma.leagueSettings.updateMany({
        data: {
          expectedTotalPlayersPerOwner: totalRounds,
          totalRounds,
          currentDraftRound: 1,
          currentDraftPick: 1,
        },
      }),
    ]);

    revalidateKeeperViews();
    redirectWithKeeperFeedback("success", `Draft order saved and board reset for ${totalRounds} rounds.`);
  } catch (error) {
    redirectWithKeeperFeedback("error", error instanceof Error ? error.message : "Could not save draft order.");
  }
}

export async function importKeeperText(formData: FormData) {
  try {
    const ownerId = String(formData.get("ownerId") ?? "");
    const fallbackSport = String(formData.get("fallbackSport") ?? "") as Sport | "";
    const input = String(formData.get("keeperText") ?? "");
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });

    if (!owner) {
      throw new Error("Choose an owner before importing keepers.");
    }

    const parsedEntries = parseKeeperText(input);
    if (parsedEntries.length === 0) {
      throw new Error("No keeper rows were found in the pasted text.");
    }

    const ownerCodes = await prisma.ownerCode.findMany({ include: { owner: true } });
    const ownerByCode = new Map(ownerCodes.map((code) => [code.code, code.owner]));
    const targetKeys = new Set<string>();
    let importedCount = 0;

    for (const entry of parsedEntries) {
      if (!entry.playerName) {
        continue;
      }

      const sport = entry.sport ?? fallbackSport;
      if (!sport) {
        throw new Error(`Add a sport marker or choose a fallback sport for "${entry.playerName}" in round ${entry.round}.`);
      }

      if (entry.keeperTag === "K4" && entry.round !== 3) {
        throw new Error(`${entry.playerName} is marked K4 and must be kept in round 3.`);
      }

      const pickOwner = entry.pickOwnerCode ? ownerByCode.get(entry.pickOwnerCode) : owner;
      if (!pickOwner) {
        throw new Error(`Unknown pick owner code "${entry.pickOwnerCode}" in round ${entry.round}.`);
      }

      const targetKey = `${entry.round}:${pickOwner.id}`;
      if (targetKeys.has(targetKey)) {
        throw new Error(`Round ${entry.round} has multiple keepers pointed at ${pickOwner.name}'s pick. Add a different pick-owner code to one of them.`);
      }
      targetKeys.add(targetKey);

      const slot = await prisma.draftSlot.findFirst({
        where: {
          round: entry.round,
          defaultOwnerId: pickOwner.id,
        },
      });

      if (!slot) {
        throw new Error(`Could not find ${pickOwner.name}'s pick in round ${entry.round}.`);
      }

      const player = await prisma.player.upsert({
        where: { normalizedName: normalizePlayerName(entry.playerName) },
        update: {
          displayName: entry.playerName.trim(),
          sport,
        },
        create: {
          normalizedName: normalizePlayerName(entry.playerName),
          displayName: entry.playerName.trim(),
          sport,
        },
      });

      await prisma.$transaction([
        prisma.keeper.deleteMany({
          where: {
            draftSlotId: slot.id,
          },
        }),
        prisma.draftSlot.update({
          where: { id: slot.id },
          data: {
            currentOwnerId: owner.id,
            overrideOwnerCode: owner.id === slot.defaultOwnerId ? null : owner.code,
            selectedPlayerId: player.id,
            selectedPlayerName: player.displayName,
            selectedSport: sport,
            isKeeper: true,
            originalRawValue: entry.rawValue,
            selectedAt: new Date(),
          },
        }),
        prisma.keeper.create({
          data: {
            ownerId: owner.id,
            playerId: player.id,
            draftSlotId: slot.id,
            playerName: player.displayName,
            sport,
            tag: entry.keeperTag,
            originalValue: entry.rawValue,
          },
        }),
      ]);

      importedCount += 1;
    }

    revalidateKeeperViews();
    redirectWithKeeperFeedback("success", `Imported ${importedCount} keepers for ${owner.name}.`);
  } catch (error) {
    redirectWithKeeperFeedback("error", error instanceof Error ? error.message : "Could not import keeper text.");
  }
}
