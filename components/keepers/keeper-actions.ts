"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IntegrationType, Owner, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { ParsedKeeperTextEntry, parseKeeperText } from "@/lib/keepers/import";
import { buildSnakeDraftOrder, normalizePlayerName, parseSportFromValue } from "@/lib/utils/draft";

const MANUAL_KEEPER_IMPORT_SOURCE_ID = "manual-keeper-import-source";

function revalidateKeeperViews() {
  ["/keepers", "/draft", "/tracker", "/dashboard", "/owners", "/admin"].forEach((path) => revalidatePath(path));
}

function keeperFeedbackPath(status: "success" | "error", message: string) {
  return `/keepers?status=${status}&message=${encodeURIComponent(message)}`;
}

async function getManualKeeperImportSource() {
  return prisma.integrationSource.upsert({
    where: { id: MANUAL_KEEPER_IMPORT_SOURCE_ID },
    update: {
      type: IntegrationType.MANUAL_ENTRY,
      isActive: true,
      config: { adapter: "KeeperTextImport" },
    },
    create: {
      id: MANUAL_KEEPER_IMPORT_SOURCE_ID,
      type: IntegrationType.MANUAL_ENTRY,
      isActive: true,
      config: { adapter: "KeeperTextImport" },
    },
  });
}

async function applyKeeperEntry({
  owner,
  ownerByCode,
  entry,
  sport,
}: {
  owner: Owner;
  ownerByCode: Map<string, Owner>;
  entry: ParsedKeeperTextEntry;
  sport: Sport;
}) {
  if (!entry.playerName) {
    throw new Error("Keeper row does not include a player name.");
  }

  const pickOwner = entry.pickOwnerCode ? ownerByCode.get(entry.pickOwnerCode) : owner;
  if (!pickOwner) {
    throw new Error(`Unknown pick owner code "${entry.pickOwnerCode}" in round ${entry.round}.`);
  }

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
}

export async function updateDraftOrder(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Draft order saved.");

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
    redirectPath = keeperFeedbackPath("success", `Draft order saved and board reset for ${totalRounds} rounds.`);
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not save draft order.");
  }

  redirect(redirectPath);
}

export async function importKeeperText(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Keeper import complete.");

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
    const normalizedNames = parsedEntries.filter((entry) => entry.playerName).map((entry) => normalizePlayerName(entry.playerName as string));
    const existingPlayers = await prisma.player.findMany({
      where: {
        normalizedName: {
          in: normalizedNames,
        },
      },
    });
    const playerByNormalizedName = new Map(existingPlayers.map((player) => [player.normalizedName, player]));
    const source = await getManualKeeperImportSource();
    const targetKeys = new Set<string>();
    let importedCount = 0;
    const issues: Array<{ entry: ParsedKeeperTextEntry; reason: string }> = [];

    await prisma.importedRecord.deleteMany({
      where: {
        recordType: "keeper_import_issue",
        importKey: {
          startsWith: `keeper-issue:${owner.id}:`,
        },
      },
    });

    for (const entry of parsedEntries) {
      if (!entry.playerName) {
        continue;
      }

      const existingPlayer = playerByNormalizedName.get(normalizePlayerName(entry.playerName));
      const sport = entry.sport ?? existingPlayer?.sport ?? fallbackSport;
      if (!sport) {
        issues.push({ entry, reason: "Missing sport and no player database match." });
        continue;
      }

      if (entry.keeperTag === "K4" && entry.round !== 3) {
        issues.push({ entry, reason: "K4 keepers must be placed in round 3." });
        continue;
      }

      const pickOwner = entry.pickOwnerCode ? ownerByCode.get(entry.pickOwnerCode) : owner;
      if (!pickOwner) {
        issues.push({ entry, reason: `Unknown pick owner code "${entry.pickOwnerCode}".` });
        continue;
      }

      const targetKey = `${entry.round}:${pickOwner.id}`;
      if (targetKeys.has(targetKey)) {
        issues.push({ entry, reason: `Round ${entry.round} has multiple keepers pointed at ${pickOwner.name}'s pick.` });
        continue;
      }
      targetKeys.add(targetKey);

      await applyKeeperEntry({ owner, ownerByCode, entry, sport });

      importedCount += 1;
    }

    if (issues.length > 0) {
      await prisma.importedRecord.createMany({
        data: issues.map(({ entry, reason }) => ({
          integrationSourceId: source.id,
          sourceType: IntegrationType.MANUAL_ENTRY,
          recordType: "keeper_import_issue",
          rawPayload: entry.rawValue,
          normalizedPayload: {
            status: "open",
            ownerId: owner.id,
            ownerName: owner.name,
            entry,
            reason,
          },
          importKey: `keeper-issue:${owner.id}:${entry.round}:${normalizePlayerName(entry.playerName ?? entry.rawValue)}`,
        })),
      });
    }

    await prisma.importedRecord.create({
      data: {
        integrationSourceId: source.id,
        sourceType: IntegrationType.MANUAL_ENTRY,
        recordType: "keeper_import_submission",
        rawPayload: input,
        normalizedPayload: {
          ownerId: owner.id,
          ownerName: owner.name,
          importedCount,
          issueCount: issues.length,
          submittedAt: new Date().toISOString(),
        },
        importKey: `keeper-submission:${owner.id}:${Date.now()}`,
      },
    });

    revalidateKeeperViews();
    redirectPath = keeperFeedbackPath(
      issues.length > 0 ? "error" : "success",
      `Imported ${importedCount} keepers for ${owner.name}. ${issues.length} unresolved player${issues.length === 1 ? "" : "s"} need review.`,
    );
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not import keeper text.");
  }

  redirect(redirectPath);
}

export async function resolveKeeperImportIssue(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Keeper row resolved.");

  try {
    const issueId = String(formData.get("issueId") ?? "");
    const sport = formData.get("sport") as Sport;
    const issue = await prisma.importedRecord.findUnique({
      where: { id: issueId },
    });

    if (!issue || issue.recordType !== "keeper_import_issue") {
      throw new Error("Could not find that unresolved keeper row.");
    }

    const payload = issue.normalizedPayload as {
      ownerId?: string;
      entry?: ParsedKeeperTextEntry;
    } | null;
    const ownerId = payload?.ownerId;
    const entry = payload?.entry;

    if (!ownerId || !entry?.playerName) {
      throw new Error("That unresolved keeper row is missing owner or player details.");
    }

    const [owner, ownerCodes] = await Promise.all([
      prisma.owner.findUnique({ where: { id: ownerId } }),
      prisma.ownerCode.findMany({ include: { owner: true } }),
    ]);

    if (!owner) {
      throw new Error("Could not find the keeper owner.");
    }

    await applyKeeperEntry({
      owner,
      ownerByCode: new Map(ownerCodes.map((code) => [code.code, code.owner])),
      entry,
      sport,
    });

    await prisma.importedRecord.update({
      where: { id: issue.id },
      data: {
        normalizedPayload: {
          ...(payload ?? {}),
          status: "resolved",
          resolvedSport: sport,
          resolvedAt: new Date().toISOString(),
        },
      },
    });

    revalidateKeeperViews();
    redirectPath = keeperFeedbackPath("success", `Resolved ${entry.playerName}.`);
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not resolve keeper row.");
  }

  redirect(redirectPath);
}

export async function importPlayerDatabaseText(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Player database import complete.");

  try {
    const input = String(formData.get("playerDatabaseText") ?? "");
    const rows = input
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean);

    let importedCount = 0;
    let unresolvedCount = 0;

    for (const row of rows) {
      const csvParts = row.split(",").map((part) => part.trim()).filter(Boolean);
      const rawName =
        csvParts.length >= 2
          ? csvParts.slice(0, -1).join(", ")
          : row.replace(/\s+(NHL|MLB|NFL|NBA|PGA|GOLF|HOCKEY|BASEBALL|FOOTBALL|BASKETBALL)$/i, "").trim();
      const sportToken = csvParts.length >= 2 ? csvParts[csvParts.length - 1] : row;
      const sport = parseSportFromValue(sportToken);

      if (!rawName || !sport) {
        unresolvedCount += 1;
        continue;
      }

      await prisma.player.upsert({
        where: { normalizedName: normalizePlayerName(rawName) },
        update: {
          displayName: rawName,
          sport,
        },
        create: {
          normalizedName: normalizePlayerName(rawName),
          displayName: rawName,
          sport,
        },
      });

      importedCount += 1;
    }

    revalidateKeeperViews();
    redirectPath = keeperFeedbackPath(
      unresolvedCount > 0 ? "error" : "success",
      `Imported ${importedCount} players into the player database. ${unresolvedCount} row${unresolvedCount === 1 ? "" : "s"} could not be read.`,
    );
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not import player database rows.");
  }

  redirect(redirectPath);
}
