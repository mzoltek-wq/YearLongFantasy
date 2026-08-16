"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IntegrationType, Owner, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TOTAL_ROUNDS } from "@/lib/constants/league";
import { ParsedKeeperTextEntry, parseKeeperText } from "@/lib/keepers/import";
import { buildSnakeDraftOrder, normalizePlayerName, parseSportFromValue } from "@/lib/utils/draft";

const MANUAL_KEEPER_IMPORT_SOURCE_ID = "manual-keeper-import-source";
const OWNER_CODE_TOKEN_REGEX = /\(([A-Z]{2})\)/i;
const KEEPER_TAG_VALUES = new Set(["K1", "K2", "K3", "K4"]);

function revalidateKeeperViews() {
  ["/keepers", "/draft", "/tracker", "/league-view", "/rosters", "/dashboard", "/owners", "/admin"].forEach((path) => revalidatePath(path));
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

  if (slot.currentOwnerId !== owner.id) {
    throw new Error(`${owner.name} does not currently own ${pickOwner.name}'s round ${entry.round} pick.`);
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

async function applyGridKeeperEntry({
  slotId,
  owner,
  overrideOwnerCode,
  entry,
  sport,
}: {
  slotId: string;
  owner: Owner;
  overrideOwnerCode: string | null;
  entry: ParsedKeeperTextEntry;
  sport: Sport;
}) {
  if (!entry.playerName) {
    throw new Error("Keeper row does not include a player name.");
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
        draftSlotId: slotId,
      },
    }),
    prisma.draftSlot.update({
      where: { id: slotId },
      data: {
        currentOwnerId: owner.id,
        overrideOwnerCode,
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
        draftSlotId: slotId,
        playerName: player.displayName,
        sport,
        tag: entry.keeperTag,
        originalValue: entry.rawValue,
      },
    }),
  ]);
}

function getOwnerCodeFromRawValue(rawValue: string, ownerByCode: Map<string, Owner>) {
  for (const match of rawValue.matchAll(/\(([A-Z]{2})\)/gi)) {
    const code = match[1]?.toUpperCase();
    if (code && ownerByCode.has(code)) {
      return code;
    }
  }

  return null;
}

function getOwnerScopedImportRecordWhere(ownerId: string) {
  return {
    recordType: {
      in: ["keeper_import_issue", "keeper_import_submission", "keeper_import_approval"],
    },
    importKey: { startsWith: `keeper-${ownerId}:` },
  };
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
      prisma.importedRecord.deleteMany({
        where: {
          recordType: {
            in: ["keeper_import_issue", "keeper_import_submission", "keeper_import_approval", "keeper_full_grid_import_log"],
          },
        },
      }),
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
    const parsedPlayerEntries = parsedEntries.filter((entry): entry is ParsedKeeperTextEntry & { playerName: string } => Boolean(entry.playerName));
    const normalizedNames = parsedPlayerEntries.map((entry) => normalizePlayerName(entry.playerName));
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
    const seenPlayerNames = new Set<string>();
    let importedCount = 0;
    const issues: Array<{ entry: ParsedKeeperTextEntry; reason: string }> = [];
    const k4Count = parsedPlayerEntries.filter((entry) => entry.keeperTag === "K4").length;
    const expectedKeeperCount = k4Count > 0 ? 26 : 25;

    if (parsedPlayerEntries.length !== expectedKeeperCount) {
      issues.push({
        entry: {
          round: 0,
          rawValue: `${parsedPlayerEntries.length} submitted keepers`,
          playerName: null,
          sport: null,
          keeperTag: null,
          invalidKeeperTags: [],
          pickOwnerCode: null,
        },
        reason: `Expected ${expectedKeeperCount} keepers for ${owner.name}${k4Count > 0 ? " because a K4 was submitted" : ""}, but found ${parsedPlayerEntries.length}.`,
      });
    }

    if (k4Count > 1) {
      issues.push({
        entry: {
          round: 0,
          rawValue: `${k4Count} K4 keepers`,
          playerName: null,
          sport: null,
          keeperTag: null,
          invalidKeeperTags: [],
          pickOwnerCode: null,
        },
        reason: `${owner.name} can only use one K4 keeper.`,
      });
    }

    await prisma.importedRecord.deleteMany({
      where: {
        ...getOwnerScopedImportRecordWhere(owner.id),
      },
    });

    for (const entry of parsedEntries) {
      if (!entry.playerName) {
        continue;
      }

      const normalizedPlayerName = normalizePlayerName(entry.playerName);
      if (seenPlayerNames.has(normalizedPlayerName)) {
        issues.push({ entry, reason: `"${entry.playerName}" appears more than once in this keeper submission.` });
        continue;
      }
      seenPlayerNames.add(normalizedPlayerName);

      if (entry.invalidKeeperTags.length > 0) {
        issues.push({ entry, reason: `Invalid keeper tag ${entry.invalidKeeperTags.join(", ")}. Use K1, K2, K3, or K4.` });
        continue;
      }

      if (!entry.keeperTag) {
        issues.push({ entry, reason: "Missing keeper tag. Use K1, K2, K3, or K4." });
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

      try {
        await applyKeeperEntry({ owner, ownerByCode, entry, sport });
        importedCount += 1;
      } catch (error) {
        issues.push({ entry, reason: error instanceof Error ? error.message : "Could not place this keeper." });
      }
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
          importKey: `keeper-${owner.id}:issue:${entry.round}:${normalizePlayerName(entry.playerName ?? entry.rawValue)}`,
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
        importKey: `keeper-${owner.id}:submission:${Date.now()}`,
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

export async function importFullKeeperGridText(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Full keeper grid imported.");

  try {
    const input = String(formData.get("fullKeeperGridText") ?? "").trim();
    const fallbackSport = String(formData.get("fallbackSport") ?? "") as Sport | "";

    if (!input) {
      throw new Error("Paste the full keeper grid before importing.");
    }

    const [owners, ownerCodes, draftSlots, rosterLimits] = await Promise.all([
      prisma.owner.findMany(),
      prisma.ownerCode.findMany({ include: { owner: true } }),
      prisma.draftSlot.findMany(),
      prisma.rosterLimit.findMany(),
    ]);
    const ownerByName = new Map(owners.map((owner) => [owner.name.toLowerCase(), owner]));
    const ownerByCode = new Map(ownerCodes.map((code) => [code.code.toUpperCase(), code.owner]));
    const rows = input.split(/\r?\n/).map((row) => row.split("\t").map((cell) => cell.trim()));
    const headerIndex = rows.findIndex((row) => row.filter((cell) => ownerByName.has(cell.toLowerCase())).length >= 2);

    if (headerIndex === -1) {
      throw new Error("Could not find an owner header row in the pasted keeper grid.");
    }

    const ownerColumns = rows[headerIndex]
      .map((cell, index) => ({ owner: ownerByName.get(cell.toLowerCase()), index }))
      .filter((entry): entry is { owner: Owner; index: number } => Boolean(entry.owner));
    const rosterTotalRounds = rosterLimits.reduce((total, limit) => total + limit.perOwnerLimit, 0);
    const targetTotalRounds = Math.max(DEFAULT_TOTAL_ROUNDS, rosterTotalRounds);
    let activeDraftSlots = draftSlots;
    const currentMaxDraftRound = Math.max(0, ...draftSlots.map((slot) => slot.round));

    if (currentMaxDraftRound < targetTotalRounds) {
      const roundOneSlots = draftSlots.filter((slot) => slot.round === 1).sort((left, right) => left.slotNumber - right.slotNumber);

      if (roundOneSlots.length !== owners.length) {
        throw new Error("The draft board needs to be rebuilt, but round 1 does not include all owners. Save draft order first.");
      }

      const rebuiltSlots = buildSnakeDraftOrder(
        roundOneSlots.map((slot) => slot.defaultOwnerId),
        targetTotalRounds,
      );

      await prisma.$transaction([
        prisma.keeper.deleteMany(),
        prisma.draftSlot.deleteMany(),
        prisma.draftSlot.createMany({
          data: rebuiltSlots.map((slot) => ({
            round: slot.round,
            slotNumber: slot.slotNumber,
            overallPickNumber: slot.overallPickNumber,
            defaultOwnerId: slot.ownerId,
            currentOwnerId: slot.ownerId,
          })),
        }),
        prisma.leagueSettings.updateMany({
          data: {
            expectedTotalPlayersPerOwner: targetTotalRounds,
            totalRounds: targetTotalRounds,
            currentDraftRound: 1,
            currentDraftPick: 1,
          },
        }),
      ]);

      activeDraftSlots = await prisma.draftSlot.findMany();
    }

    const slotByRoundAndDefaultOwner = new Map(activeDraftSlots.map((slot) => [`${slot.round}:${slot.defaultOwnerId}`, slot]));
    const source = await getManualKeeperImportSource();
    const issues: Array<{ owner: Owner; entry: ParsedKeeperTextEntry; reason: string }> = [];
    const seenPlayerNames = new Set<string>();
    const importedCountByOwnerId = new Map<string, number>();
    const k4CountByOwnerId = new Map<string, number>();
    let nonEmptyCellCount = 0;
    let parsedPlayerEntryCount = 0;
    let skippedMissingKeeperTagCount = 0;
    const skippedMissingKeeperTagSamples: Array<{
      ownerName: string;
      round: number;
      rawValue: string;
      parsedPlayerName: string | null;
    }> = [];
    const placementSamples: Array<{
      playerName: string;
      round: number;
      originalPickOwner: string;
      assignedOwner: string;
      ownerCode: string | null;
      rawValue: string;
    }> = [];

    await prisma.keeper.deleteMany();
    await prisma.importedRecord.deleteMany({
      where: {
        recordType: {
          in: ["keeper_import_issue", "keeper_import_submission", "keeper_import_approval", "keeper_full_grid_import_log"],
        },
      },
    });

    for (let index = 0; index < activeDraftSlots.length; index += 25) {
      await prisma.$transaction(
        activeDraftSlots.slice(index, index + 25).map((slot) =>
          prisma.draftSlot.update({
            where: { id: slot.id },
            data: {
              currentOwnerId: slot.defaultOwnerId,
              overrideOwnerCode: null,
              selectedPlayerId: null,
              selectedPlayerName: null,
              selectedSport: null,
              isKeeper: false,
              originalRawValue: null,
              selectedAt: null,
            },
          }),
        ),
      );
    }

    const rawPlayerNames: string[] = [];
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const explicitRound = Number(row[0]);
      const round = Number.isInteger(explicitRound) && explicitRound > 0 ? explicitRound : rowIndex - headerIndex;

      for (const ownerColumn of ownerColumns) {
        const rawValue = row[ownerColumn.index] ?? "";
        const parsedEntries = parseKeeperText(`${round} ${rawValue}`).filter((entry) => entry.playerName);
        rawPlayerNames.push(...parsedEntries.map((entry) => entry.playerName!).filter(Boolean));
      }
    }

    const existingPlayers = await prisma.player.findMany({
      where: {
        normalizedName: {
          in: rawPlayerNames.map((name) => normalizePlayerName(name)),
        },
      },
    });
    const playerByNormalizedName = new Map(existingPlayers.map((player) => [player.normalizedName, player]));

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const explicitRound = Number(row[0]);
      const round = Number.isInteger(explicitRound) && explicitRound > 0 ? explicitRound : rowIndex - headerIndex;

      for (const ownerColumn of ownerColumns) {
        const rawValue = row[ownerColumn.index] ?? "";
        if (!rawValue) {
          continue;
        }
        nonEmptyCellCount += 1;

        if (round > targetTotalRounds) {
          issues.push({
            owner: ownerColumn.owner,
            entry: {
              round,
              rawValue,
              playerName: null,
              sport: null,
              keeperTag: null,
              invalidKeeperTags: [],
              pickOwnerCode: null,
            },
            reason: `Round ${round} is outside the configured ${targetTotalRounds}-round draft.`,
          });
          continue;
        }

        const pickOwnerCode = getOwnerCodeFromRawValue(rawValue, ownerByCode);
        const pickOwner = pickOwnerCode ? ownerByCode.get(pickOwnerCode)! : ownerColumn.owner;
        const currentOwner = ownerColumn.owner;
        const appliedOverrideCode = currentOwner.id === pickOwner.id ? null : currentOwner.code;
        const slot = slotByRoundAndDefaultOwner.get(`${round}:${pickOwner.id}`);
        if (!slot) {
          issues.push({
            owner: currentOwner,
            entry: {
              round,
              rawValue,
              playerName: null,
              sport: null,
              keeperTag: null,
              invalidKeeperTags: [],
              pickOwnerCode: null,
            },
            reason: `Could not find ${pickOwner.name}'s pick in round ${round}.`,
          });
          continue;
        }

        if (appliedOverrideCode) {
          await prisma.draftSlot.update({
            where: { id: slot.id },
            data: {
              currentOwnerId: currentOwner.id,
              overrideOwnerCode: appliedOverrideCode,
            },
          });
        }

        const parsedEntries = parseKeeperText(`${round} ${rawValue}`).filter((entry) => entry.playerName);
        parsedPlayerEntryCount += parsedEntries.length;
        if (parsedEntries.length === 0) {
          continue;
        }

        if (parsedEntries.length > 1) {
          issues.push({
            owner: currentOwner,
            entry: {
              ...parsedEntries[0],
              pickOwnerCode,
            },
            reason: "This grid cell contains multiple players. One draft slot can only hold one keeper.",
          });
          continue;
        }

        const entry = {
          ...parsedEntries[0],
          pickOwnerCode,
        };

        if (!entry.playerName) {
          continue;
        }

        const normalizedPlayerName = normalizePlayerName(entry.playerName);
        if (seenPlayerNames.has(normalizedPlayerName)) {
          issues.push({ owner: currentOwner, entry, reason: `"${entry.playerName}" appears more than once in the full keeper grid.` });
          continue;
        }
        seenPlayerNames.add(normalizedPlayerName);

        if (entry.invalidKeeperTags.length > 0) {
          issues.push({ owner: currentOwner, entry, reason: `Invalid keeper tag ${entry.invalidKeeperTags.join(", ")}. Use K1, K2, K3, or K4.` });
          continue;
        }

        if (!entry.keeperTag) {
          skippedMissingKeeperTagCount += 1;
          if (skippedMissingKeeperTagSamples.length < 12) {
            skippedMissingKeeperTagSamples.push({
              ownerName: currentOwner.name,
              round,
              rawValue,
              parsedPlayerName: entry.playerName,
            });
          }
          continue;
        }

        const existingPlayer = playerByNormalizedName.get(normalizedPlayerName);
        const sport = entry.sport ?? existingPlayer?.sport ?? fallbackSport;
        if (!sport) {
          issues.push({ owner: currentOwner, entry, reason: "Missing sport and no player database match." });
          continue;
        }

        if (entry.keeperTag === "K4" && entry.round !== 3) {
          issues.push({ owner: currentOwner, entry, reason: "K4 keepers must be placed in round 3." });
          continue;
        }

        if (entry.keeperTag === "K4") {
          k4CountByOwnerId.set(currentOwner.id, (k4CountByOwnerId.get(currentOwner.id) ?? 0) + 1);
        }

        try {
          await applyGridKeeperEntry({ slotId: slot.id, owner: currentOwner, overrideOwnerCode: appliedOverrideCode, entry, sport });
          importedCountByOwnerId.set(currentOwner.id, (importedCountByOwnerId.get(currentOwner.id) ?? 0) + 1);
          if (placementSamples.length < 30) {
            placementSamples.push({
              playerName: entry.playerName,
              round,
              originalPickOwner: pickOwner.name,
              assignedOwner: currentOwner.name,
              ownerCode: pickOwnerCode,
              rawValue,
            });
          }
        } catch (error) {
          issues.push({ owner: currentOwner, entry, reason: error instanceof Error ? error.message : "Could not place this keeper." });
        }
      }
    }

    const finalDraftSlots = await prisma.draftSlot.findMany({
      select: {
        currentOwnerId: true,
        selectedPlayerName: true,
      },
    });

    for (const owner of owners) {
      const importedCount = importedCountByOwnerId.get(owner.id) ?? 0;
      const k4Count = k4CountByOwnerId.get(owner.id) ?? 0;
      const expectedKeeperCount = k4Count > 0 ? 26 : 25;
      const openPickCount = finalDraftSlots.filter((slot) => slot.currentOwnerId === owner.id && !slot.selectedPlayerName).length;
      const totalSpotsAccountedFor = importedCount + openPickCount;

      if (importedCount !== 25 && importedCount !== 26) {
        issues.push({
          owner,
          entry: {
            round: 0,
            rawValue: `${importedCount} imported keepers`,
            playerName: null,
            sport: null,
            keeperTag: null,
            invalidKeeperTags: [],
            pickOwnerCode: null,
          },
          reason: `Expected 25 or 26 keepers for ${owner.name}, but found ${importedCount}.`,
        });
      } else if (importedCount !== expectedKeeperCount) {
        issues.push({
          owner,
          entry: {
            round: 0,
            rawValue: `${importedCount} imported keepers`,
            playerName: null,
            sport: null,
            keeperTag: null,
            invalidKeeperTags: [],
            pickOwnerCode: null,
          },
          reason: `Expected ${expectedKeeperCount} keepers for ${owner.name}${k4Count > 0 ? " because a K4 was imported" : ""}, but found ${importedCount}.`,
        });
      }

      if (totalSpotsAccountedFor !== targetTotalRounds) {
        issues.push({
          owner,
          entry: {
            round: 0,
            rawValue: `${importedCount} keepers + ${openPickCount} picks`,
            playerName: null,
            sport: null,
            keeperTag: null,
            invalidKeeperTags: [],
            pickOwnerCode: null,
          },
          reason: `${owner.name} has ${importedCount} keepers and ${openPickCount} open picks, totaling ${totalSpotsAccountedFor}. Expected ${targetTotalRounds}.`,
        });
      }

      if (k4Count > 1) {
        issues.push({
          owner,
          entry: {
            round: 0,
            rawValue: `${k4Count} K4 keepers`,
            playerName: null,
            sport: null,
            keeperTag: null,
            invalidKeeperTags: [],
            pickOwnerCode: null,
          },
          reason: `${owner.name} can only use one K4 keeper.`,
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
            issueCount: issues.filter((issue) => issue.owner.id === owner.id).length,
            submittedAt: new Date().toISOString(),
          },
          importKey: `keeper-${owner.id}:submission:${Date.now()}`,
        },
      });
    }

    if (issues.length > 0) {
      await prisma.importedRecord.createMany({
        data: issues.map(({ owner, entry, reason }, index) => ({
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
          importKey: `keeper-${owner.id}:issue:${Date.now()}:${index}`,
        })),
      });
    }

    const issueReasonCounts = issues.reduce((counts, issue) => {
      counts.set(issue.reason, (counts.get(issue.reason) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
    const topIssueReasons = Array.from(issueReasonCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count }));
    const importedTotal = Array.from(importedCountByOwnerId.values()).reduce((total, count) => total + count, 0);

    await prisma.importedRecord.create({
      data: {
        integrationSourceId: source.id,
        sourceType: IntegrationType.MANUAL_ENTRY,
        recordType: "keeper_full_grid_import_log",
        rawPayload: input.slice(0, 5000),
        normalizedPayload: {
          importedTotal,
          issueCount: issues.length,
          rowCount: Math.max(rows.length - headerIndex - 1, 0),
          ownerColumnCount: ownerColumns.length,
          targetTotalRounds,
          nonEmptyCellCount,
          parsedPlayerEntryCount,
          skippedMissingKeeperTagCount,
          skippedMissingKeeperTagSamples,
          topIssueReasons,
          placementSamples,
          importedCountByOwner: owners.map((owner) => ({
            ownerId: owner.id,
            ownerName: owner.name,
            importedCount: importedCountByOwnerId.get(owner.id) ?? 0,
            openPickCount: finalDraftSlots.filter((slot) => slot.currentOwnerId === owner.id && !slot.selectedPlayerName).length,
            k4Count: k4CountByOwnerId.get(owner.id) ?? 0,
          })),
          importedAt: new Date().toISOString(),
        },
        importKey: `keeper-full-grid-log:${Date.now()}`,
      },
    });

    revalidateKeeperViews();
    const reasonSummary =
      topIssueReasons.length > 0
        ? ` Top issues: ${topIssueReasons
            .slice(0, 3)
            .map((entry) => `${entry.count}x ${entry.reason}`)
            .join("; ")}.`
        : "";
    redirectPath = keeperFeedbackPath(
      issues.length > 0 ? "error" : "success",
      `Full grid import complete. Imported ${importedTotal} keepers with ${issues.length} issue${issues.length === 1 ? "" : "s"}.${reasonSummary}`,
    );
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not import the full keeper grid.");
  }

  redirect(redirectPath);
}

export async function approveKeeperSubmission(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Keeper submission approved.");

  try {
    const ownerId = String(formData.get("ownerId") ?? "");
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
    const source = await getManualKeeperImportSource();

    if (!owner) {
      throw new Error("Choose an owner to approve.");
    }

    await prisma.$transaction([
      prisma.importedRecord.updateMany({
        where: {
          recordType: "keeper_import_issue",
          importKey: { startsWith: `keeper-${owner.id}:` },
        },
        data: {
          normalizedPayload: {
            status: "approved",
            ownerId: owner.id,
            ownerName: owner.name,
            approvedAt: new Date().toISOString(),
            reason: "Manually approved by commissioner.",
          },
        },
      }),
      prisma.importedRecord.create({
        data: {
          integrationSourceId: source.id,
          sourceType: IntegrationType.MANUAL_ENTRY,
          recordType: "keeper_import_approval",
          rawPayload: `${owner.name} approved`,
          normalizedPayload: {
            ownerId: owner.id,
            ownerName: owner.name,
            approvedAt: new Date().toISOString(),
          },
          importKey: `keeper-${owner.id}:approval:${Date.now()}`,
        },
      }),
    ]);

    revalidateKeeperViews();
    redirectPath = keeperFeedbackPath("success", `${owner.name}'s keeper submission was approved.`);
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not approve keeper submission.");
  }

  redirect(redirectPath);
}

export async function resolveKeeperImportIssue(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Keeper row resolved.");

  try {
    const issueId = String(formData.get("issueId") ?? "");
    const action = String(formData.get("issueAction") ?? "resolve");
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
    const originalEntry = payload?.entry;

    if (!ownerId) {
      throw new Error("That unresolved keeper row is missing owner details.");
    }

    if (action === "ignore") {
      await prisma.importedRecord.update({
        where: { id: issue.id },
        data: {
          normalizedPayload: {
            ...(payload ?? {}),
            status: "ignored",
            ignoredAt: new Date().toISOString(),
          },
        },
      });

      revalidateKeeperViews();
      redirectPath = keeperFeedbackPath("success", "Keeper issue ignored.");
    } else if (!originalEntry?.playerName) {
      throw new Error("That unresolved keeper row is missing player details.");
    } else {
      const [owner, ownerCodes] = await Promise.all([
        prisma.owner.findUnique({ where: { id: ownerId } }),
        prisma.ownerCode.findMany({ include: { owner: true } }),
      ]);

      if (!owner) {
        throw new Error("Could not find the keeper owner.");
      }

      const round = Number(formData.get("round") ?? originalEntry.round);
      const keeperTag = String(formData.get("keeperTag") ?? originalEntry.keeperTag ?? "").trim().toUpperCase();
      const pickOwnerCode = String(formData.get("pickOwnerCode") ?? originalEntry.pickOwnerCode ?? "").trim().toUpperCase() || null;

      if (!Number.isInteger(round) || round <= 0) {
        throw new Error("Enter a valid keeper round.");
      }

      if (!KEEPER_TAG_VALUES.has(keeperTag)) {
        throw new Error("Keeper status must be K1, K2, K3, or K4.");
      }

      if (keeperTag === "K4" && round !== 3) {
        throw new Error("K4 keepers must be placed in round 3.");
      }

      const entry: ParsedKeeperTextEntry = {
        ...originalEntry,
        round,
        keeperTag,
        invalidKeeperTags: [],
        pickOwnerCode,
      };

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
            resolvedEntry: entry,
            resolvedAt: new Date().toISOString(),
          },
        },
      });

      revalidateKeeperViews();
      redirectPath = keeperFeedbackPath("success", `Resolved ${entry.playerName}.`);
    }
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not resolve keeper row.");
  }

  redirect(redirectPath);
}

export async function rejectKeeperSubmission(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Keeper submission rejected.");

  try {
    const ownerId = String(formData.get("ownerId") ?? "");
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });

    if (!owner) {
      throw new Error("Choose an owner to reject.");
    }

    const keepers = await prisma.keeper.findMany({
      where: { ownerId: owner.id },
      select: { id: true, draftSlotId: true },
    });
    const draftSlotIds = keepers.map((keeper) => keeper.draftSlotId).filter((id): id is string => Boolean(id));

    await prisma.$transaction([
      prisma.keeper.deleteMany({ where: { ownerId: owner.id } }),
      prisma.draftSlot.updateMany({
        where: { id: { in: draftSlotIds } },
        data: {
          selectedPlayerId: null,
          selectedPlayerName: null,
          selectedSport: null,
          isKeeper: false,
          originalRawValue: null,
          selectedAt: null,
        },
      }),
      prisma.importedRecord.deleteMany({
        where: {
          ...getOwnerScopedImportRecordWhere(owner.id),
        },
      }),
    ]);

    revalidateKeeperViews();
    redirectPath = keeperFeedbackPath("success", `${owner.name}'s keeper import was rejected and cleared.`);
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not reject keeper submission.");
  }

  redirect(redirectPath);
}

export async function importTradedPicksText(formData: FormData) {
  let redirectPath = keeperFeedbackPath("success", "Traded picks imported.");

  try {
    const input = String(formData.get("tradedPicksText") ?? "").trim();
    if (!input) {
      throw new Error("Paste the traded-pick grid before importing.");
    }

    const [owners, ownerCodes] = await Promise.all([prisma.owner.findMany(), prisma.ownerCode.findMany({ include: { owner: true } })]);
    const ownerByName = new Map(owners.map((owner) => [owner.name.toLowerCase(), owner]));
    const ownerByCode = new Map(ownerCodes.map((code) => [code.code, code.owner]));
    const rows = input.split(/\r?\n/).map((row) => row.split("\t").map((cell) => cell.trim()));
    const headerIndex = rows.findIndex((row) => row.filter((cell) => ownerByName.has(cell.toLowerCase())).length >= 2);

    if (headerIndex === -1) {
      throw new Error("Could not find an owner header row in the pasted traded-pick grid.");
    }

    const ownerColumns = rows[headerIndex]
      .map((cell, index) => ({ owner: ownerByName.get(cell.toLowerCase()), index }))
      .filter((entry): entry is { owner: Owner; index: number } => Boolean(entry.owner));

    let importedCount = 0;
    const updates: Array<ReturnType<typeof prisma.draftSlot.updateMany>> = [];

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const explicitRound = Number(row[0]);
      const round = Number.isInteger(explicitRound) && explicitRound > 0 ? explicitRound : rowIndex - headerIndex;

      for (const ownerColumn of ownerColumns) {
        const rawValue = row[ownerColumn.index] ?? "";
        const code = rawValue.match(OWNER_CODE_TOKEN_REGEX)?.[1]?.toUpperCase();

        if (!code) {
          continue;
        }

        const currentOwner = ownerByCode.get(code);
        if (!currentOwner) {
          throw new Error(`Unknown traded-pick owner code "${code}" in round ${round}.`);
        }

        updates.push(
          prisma.draftSlot.updateMany({
            where: {
              round,
              defaultOwnerId: ownerColumn.owner.id,
            },
            data: {
              currentOwnerId: currentOwner.id,
              overrideOwnerCode: code,
            },
          }),
        );
        importedCount += 1;
      }
    }

    if (updates.length === 0) {
      throw new Error("No traded-pick owner codes were found in the pasted grid.");
    }

    for (let index = 0; index < updates.length; index += 25) {
      await prisma.$transaction(updates.slice(index, index + 25));
    }

    revalidateKeeperViews();
    redirectPath = keeperFeedbackPath("success", `Imported ${importedCount} traded-pick overrides.`);
  } catch (error) {
    redirectPath = keeperFeedbackPath("error", error instanceof Error ? error.message : "Could not import traded picks.");
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
