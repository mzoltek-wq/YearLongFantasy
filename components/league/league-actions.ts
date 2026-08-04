"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PickChangeSource } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

const OWNER_CODE_TOKEN_REGEX = /\(([A-Z]{2})\)/i;

function leagueGridFeedbackPath(year: number, status: "success" | "error", message: string) {
  return `/league/${year}/grid?status=${status}&message=${encodeURIComponent(message)}`;
}

export async function importV2TradedPicksText(formData: FormData) {
  const year = Number(formData.get("year"));
  let redirectPath = leagueGridFeedbackPath(Number.isInteger(year) ? year : new Date().getFullYear(), "success", "Traded picks imported.");

  try {
    if (!Number.isInteger(year)) {
      throw new Error("Choose a valid league year before importing traded picks.");
    }

    const input = String(formData.get("tradedPicksText") ?? "").trim();
    if (!input) {
      throw new Error("Paste the current-year draft grid before importing traded picks.");
    }

    const season = await prisma.leagueSeason.findFirst({
      where: { year },
      include: {
        drafts: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
        seasonManagers: {
          include: { manager: true },
        },
      },
    });

    if (!season || season.drafts.length === 0) {
      throw new Error(`Could not find a draft grid for ${year}.`);
    }

    const draft = season.drafts[0];
    const managers = season.seasonManagers.map((entry) => entry.manager);
    const managerByName = new Map<string, (typeof managers)[number]>();
    const managerByCode = new Map<string, (typeof managers)[number]>();

    for (const manager of managers) {
      managerByName.set(manager.name.trim().toLowerCase(), manager);
      managerByCode.set(manager.code.toUpperCase(), manager);

      if (manager.displayName) {
        managerByName.set(manager.displayName.trim().toLowerCase(), manager);
      }
    }

    const ownerCodeAliases = await prisma.ownerCode.findMany({ include: { owner: true } });

    for (const alias of ownerCodeAliases) {
      const matchingManager = managerByName.get(alias.owner.name.trim().toLowerCase());
      if (matchingManager) {
        managerByCode.set(alias.code.toUpperCase(), matchingManager);
      }
    }
    const rows = input.split(/\r?\n/).map((row) => row.split("\t").map((cell) => cell.trim()));
    const headerIndex = rows.findIndex((row) => row.filter((cell) => managerByName.has(cell.trim().toLowerCase())).length >= 2);

    if (headerIndex === -1) {
      throw new Error("Could not find a manager header row in the pasted grid.");
    }

    const managerColumns = rows[headerIndex]
      .map((cell, index) => ({ manager: managerByName.get(cell.trim().toLowerCase()), index }))
      .filter((entry): entry is { manager: (typeof managers)[number]; index: number } => Boolean(entry.manager));

    if (managerColumns.length < 2) {
      throw new Error("The pasted grid needs at least two recognizable manager columns.");
    }

    const changedPicks: Array<{
      round: number;
      originalManagerId: string;
      currentManagerId: string;
      code: string;
      rawValue: string;
    }> = [];

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const explicitRound = Number(row[0]);
      const round = Number.isInteger(explicitRound) && explicitRound > 0 ? explicitRound : rowIndex - headerIndex;

      if (round > season.roundCount) {
        continue;
      }

      for (const managerColumn of managerColumns) {
        const rawValue = row[managerColumn.index] ?? "";
        const code = rawValue.match(OWNER_CODE_TOKEN_REGEX)?.[1]?.toUpperCase();

        if (!code) {
          continue;
        }

        const currentManager = managerByCode.get(code);
        if (!currentManager) {
          throw new Error(`Unknown manager code "${code}" in round ${round}.`);
        }

        changedPicks.push({
          round,
          originalManagerId: managerColumn.manager.id,
          currentManagerId: currentManager.id,
          code,
          rawValue,
        });
      }
    }

    let appliedCount = 0;

    await prisma.$transaction(async (tx) => {
      const slots = await tx.draftGridSlot.findMany({
        where: { draftId: draft.id },
        select: {
          id: true,
          round: true,
          originalManagerId: true,
          currentManagerId: true,
        },
      });
      const slotByRoundAndOriginalManager = new Map(slots.map((slot) => [`${slot.round}:${slot.originalManagerId}`, slot]));

      await tx.pickOwnershipChange.deleteMany({
        where: {
          seasonId: season.id,
          draftGridSlotId: {
            in: slots.map((slot) => slot.id),
          },
        },
      });

      await Promise.all(
        slots.map((slot) =>
          tx.draftGridSlot.update({
            where: { id: slot.id },
            data: {
              currentManagerId: slot.originalManagerId,
              rawCellValue: null,
            },
          }),
        ),
      );

      for (const pick of changedPicks) {
        const slot = slotByRoundAndOriginalManager.get(`${pick.round}:${pick.originalManagerId}`);

        if (!slot) {
          throw new Error(`Could not find round ${pick.round} pick for one pasted manager column.`);
        }

        if (slot.originalManagerId === pick.currentManagerId) {
          continue;
        }

        await tx.draftGridSlot.update({
          where: { id: slot.id },
          data: {
            currentManagerId: pick.currentManagerId,
            rawCellValue: pick.rawValue,
          },
        });

        await tx.pickOwnershipChange.create({
          data: {
            seasonId: season.id,
            draftGridSlotId: slot.id,
            fromManagerId: slot.originalManagerId,
            toManagerId: pick.currentManagerId,
            source: PickChangeSource.IMPORT,
            notes: `Imported from pasted ${year} draft grid cell: ${pick.rawValue}`,
            approvedAt: new Date(),
          },
        });
        appliedCount += 1;
      }
    });

    revalidatePath(`/league/${year}/grid`);
    redirectPath = leagueGridFeedbackPath(year, "success", `Imported ${appliedCount} traded-pick overrides for ${year}.`);
  } catch (error) {
    redirectPath = leagueGridFeedbackPath(
      Number.isInteger(year) ? year : new Date().getFullYear(),
      "error",
      error instanceof Error ? error.message : "Could not import traded picks.",
    );
  }

  redirect(redirectPath);
}
