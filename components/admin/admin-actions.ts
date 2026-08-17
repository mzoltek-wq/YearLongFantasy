"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IntegrationType, PickChangeSource, Prisma, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  getGoogleSheetSourceConfig,
  importSheetRows,
  parseImportText,
  pushFullDraftBoardToGoogleSheetWebhook,
  saveGoogleSheetSourceConfig,
  syncLeagueFromKeeperGoogleSheet,
} from "@/lib/import/google-sheets";
import { getDefaultRosterSlotTemplates, parseRosterSlotTemplate, saveRosterSlotSettings } from "@/lib/roster/settings";
import { normalizePlayerName } from "@/lib/utils/draft";

const DRAFT_STATE_SNAPSHOT_SOURCE_ID = "draft-state-snapshot-source";
const START_2026_SNAPSHOT_KEY = "draft-state-snapshot:start-2026";
const CURRENT_DRAFT_GRID_YEAR = 2026;

function revalidateAdminViews() {
  ["/admin", "/draft", "/dashboard", "/owners", "/keepers", "/tracker", "/league-view", "/rosters", "/league/2026/grid"].forEach((path) => revalidatePath(path));
}

async function getDraftStateSnapshotSource() {
  return prisma.integrationSource.upsert({
    where: { id: DRAFT_STATE_SNAPSHOT_SOURCE_ID },
    update: {
      type: IntegrationType.MANUAL_ENTRY,
      isActive: true,
      config: { adapter: "DraftStateSnapshot" },
    },
    create: {
      id: DRAFT_STATE_SNAPSHOT_SOURCE_ID,
      type: IntegrationType.MANUAL_ENTRY,
      isActive: true,
      config: { adapter: "DraftStateSnapshot" },
    },
  });
}

function normalizePersonKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

async function findManagerForOwnerId(tx: Prisma.TransactionClient, ownerId: string) {
  const owner = await tx.owner.findUnique({
    where: { id: ownerId },
  });

  if (!owner) {
    return null;
  }

  const managers = await tx.manager.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      code: true,
    },
  });
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

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function swapDraftPickOwnership(formData: FormData) {
  let redirectPath = "/admin?status=success&message=Draft%20picks%20swapped.";

  try {
    const leftOwnerId = String(formData.get("leftOwnerId") ?? "");
    const rightOwnerId = String(formData.get("rightOwnerId") ?? "");
    const leftPickNumber = Number(formData.get("leftPickNumber"));
    const rightPickNumber = Number(formData.get("rightPickNumber"));
    const notes = String(formData.get("notes") ?? "").trim();

    if (!leftOwnerId || !rightOwnerId) {
      throw new Error("Both owners are required.");
    }

    if (!Number.isInteger(leftPickNumber) || leftPickNumber <= 0 || !Number.isInteger(rightPickNumber) || rightPickNumber <= 0) {
      throw new Error("Both pick numbers must be positive whole numbers.");
    }

    if (leftPickNumber === rightPickNumber) {
      throw new Error("Pick numbers must be different.");
    }

    await prisma.$transaction(
      async (tx) => {
        const [leftSlot, rightSlot, leftOwner, rightOwner, season] = await Promise.all([
          tx.draftSlot.findUnique({
            where: { overallPickNumber: leftPickNumber },
            include: {
              currentOwner: true,
              defaultOwner: true,
            },
          }),
          tx.draftSlot.findUnique({
            where: { overallPickNumber: rightPickNumber },
            include: {
              currentOwner: true,
              defaultOwner: true,
            },
          }),
          tx.owner.findUnique({ where: { id: leftOwnerId } }),
          tx.owner.findUnique({ where: { id: rightOwnerId } }),
          tx.leagueSeason.findFirst({
            where: { year: CURRENT_DRAFT_GRID_YEAR },
            include: {
              drafts: {
                orderBy: { createdAt: "asc" },
                take: 1,
              },
            },
          }),
        ]);

        if (!leftSlot || !rightSlot) {
          throw new Error("Could not find one of those picks.");
        }

        if (!leftOwner || !rightOwner) {
          throw new Error("Could not find one of those owners.");
        }

        if (leftSlot.currentOwnerId !== leftOwner.id) {
          throw new Error(`Pick ${leftPickNumber} is currently owned by ${leftSlot.currentOwner.name}, not ${leftOwner.name}.`);
        }

        if (rightSlot.currentOwnerId !== rightOwner.id) {
          throw new Error(`Pick ${rightPickNumber} is currently owned by ${rightSlot.currentOwner.name}, not ${rightOwner.name}.`);
        }

        if (leftSlot.selectedPlayerName || rightSlot.selectedPlayerName) {
          throw new Error("Only unused/open picks can be swapped. One of those picks is already filled.");
        }

        const [leftNewOwnerCode, rightNewOwnerCode, leftManager, rightManager] = await Promise.all([
          tx.ownerCode.findFirst({
            where: { ownerId: rightOwner.id },
            orderBy: { createdAt: "asc" },
          }),
          tx.ownerCode.findFirst({
            where: { ownerId: leftOwner.id },
            orderBy: { createdAt: "asc" },
          }),
          findManagerForOwnerId(tx, leftOwner.id),
          findManagerForOwnerId(tx, rightOwner.id),
        ]);

        await Promise.all([
          tx.draftSlot.update({
            where: { id: leftSlot.id },
            data: {
              currentOwnerId: rightOwner.id,
              overrideOwnerCode: rightOwner.id === leftSlot.defaultOwnerId ? null : (leftNewOwnerCode?.code ?? rightOwner.code),
            },
          }),
          tx.draftSlot.update({
            where: { id: rightSlot.id },
            data: {
              currentOwnerId: leftOwner.id,
              overrideOwnerCode: leftOwner.id === rightSlot.defaultOwnerId ? null : (rightNewOwnerCode?.code ?? leftOwner.code),
            },
          }),
        ]);

        const draft = season?.drafts[0];
        const swapNotes =
          notes ||
          `Manual mid-draft pick swap: ${leftOwner.name} pick ${leftPickNumber} for ${rightOwner.name} pick ${rightPickNumber}.`;

        if (draft && leftManager && rightManager) {
          const [leftGridSlot, rightGridSlot] = await Promise.all([
            tx.draftGridSlot.findUnique({
              where: {
                draftId_overallPickNumber: {
                  draftId: draft.id,
                  overallPickNumber: leftPickNumber,
                },
              },
            }),
            tx.draftGridSlot.findUnique({
              where: {
                draftId_overallPickNumber: {
                  draftId: draft.id,
                  overallPickNumber: rightPickNumber,
                },
              },
            }),
          ]);

          if (leftGridSlot && rightGridSlot) {
            await Promise.all([
              tx.draftGridSlot.update({
                where: { id: leftGridSlot.id },
                data: {
                  currentManagerId: rightManager.id,
                  notes: [leftGridSlot.notes, swapNotes].filter(Boolean).join("\n"),
                },
              }),
              tx.draftGridSlot.update({
                where: { id: rightGridSlot.id },
                data: {
                  currentManagerId: leftManager.id,
                  notes: [rightGridSlot.notes, swapNotes].filter(Boolean).join("\n"),
                },
              }),
              tx.pickOwnershipChange.createMany({
                data: [
                  {
                    seasonId: season.id,
                    draftGridSlotId: leftGridSlot.id,
                    fromManagerId: leftManager.id,
                    toManagerId: rightManager.id,
                    source: PickChangeSource.MANUAL,
                    notes: swapNotes,
                    approvedAt: new Date(),
                  },
                  {
                    seasonId: season.id,
                    draftGridSlotId: rightGridSlot.id,
                    fromManagerId: rightManager.id,
                    toManagerId: leftManager.id,
                    source: PickChangeSource.MANUAL,
                    notes: swapNotes,
                    approvedAt: new Date(),
                  },
                ],
              }),
            ]);
          }
        }
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    revalidateAdminViews();
  } catch (error) {
    redirectPath = `/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not swap draft picks.")}`;
  }

  redirect(redirectPath);
}

export async function updateRosterLimits(formData: FormData) {
  let redirectPath = "/admin?status=success&message=Roster%20settings%20updated.";

  try {
    const ownerCount = await prisma.owner.count();
    const sports = Object.values(Sport);
    const defaultTemplates = getDefaultRosterSlotTemplates();
    const rosterSlotTemplates = sports.reduce<ReturnType<typeof getDefaultRosterSlotTemplates>>((accumulator, sport) => {
      const rawLimit = formData.get(`rosterLimit-${sport}`);
      const perOwnerLimit = Number(rawLimit);
      const rawSlots = String(formData.get(`rosterSlots-${sport}`) ?? "").trim();

      if (!Number.isInteger(perOwnerLimit) || perOwnerLimit <= 0) {
        throw new Error(`${sport.toLowerCase()} roster size must be a positive whole number.`);
      }

      accumulator[sport] = rawSlots ? parseRosterSlotTemplate(sport, rawSlots, perOwnerLimit) : defaultTemplates[sport];
      return accumulator;
    }, defaultTemplates);

    await prisma.$transaction(
      sports.map((sport) => {
        const perOwnerLimit = Number(formData.get(`rosterLimit-${sport}`));

        return prisma.rosterLimit.update({
          where: { sport },
          data: { perOwnerLimit, leagueTotal: perOwnerLimit * ownerCount },
        });
      }),
    );
    await saveRosterSlotSettings(rosterSlotTemplates);

    revalidateAdminViews();
  } catch (error) {
    redirectPath = `/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not update roster settings.")}`;
  }

  redirect(redirectPath);
}

export async function updateTradedPick(formData: FormData) {
  const round = Number(formData.get("round"));
  const slotNumber = Number(formData.get("slotNumber"));
  const ownerCode = String(formData.get("ownerCode") ?? "").trim().toUpperCase();
  const ownerCodeRecord = await prisma.ownerCode.findUnique({
    where: { code: ownerCode },
  });

  if (!ownerCodeRecord) {
    throw new Error(`Unknown owner code "${ownerCode}".`);
  }

  await prisma.draftSlot.update({
    where: {
      round_slotNumber: {
        round,
        slotNumber,
      },
    },
    data: {
      overrideOwnerCode: ownerCodeRecord.code,
      currentOwnerId: ownerCodeRecord.ownerId,
    },
  });

  revalidateAdminViews();
}

export async function createKeeper(formData: FormData) {
  const ownerId = String(formData.get("ownerId"));
  const round = Number(formData.get("round"));
  const playerName = String(formData.get("playerName"));
  const sport = formData.get("sport") as Sport;
  const tag = String(formData.get("tag") ?? "").trim() || null;

  const slot = await prisma.draftSlot.findFirstOrThrow({
    where: {
      round,
      currentOwnerId: ownerId,
    },
  });

  const player = await prisma.player.upsert({
    where: { normalizedName: normalizePlayerName(playerName) },
    update: {
      displayName: playerName.trim(),
      sport,
    },
    create: {
      normalizedName: normalizePlayerName(playerName),
      displayName: playerName.trim(),
      sport,
    },
  });

  await prisma.keeper.create({
    data: {
      ownerId,
      playerId: player.id,
      draftSlotId: slot.id,
      playerName: player.displayName,
      sport,
      tag,
      originalValue: `${tag ? `(${tag}) ` : ""}${player.displayName}`,
    },
  });

  await prisma.draftSlot.update({
    where: { id: slot.id },
    data: {
      selectedPlayerId: player.id,
      selectedPlayerName: player.displayName,
      selectedSport: sport,
      isKeeper: true,
      originalRawValue: `${tag ? `(${tag}) ` : ""}${player.displayName}`,
      selectedAt: new Date(),
    },
  });

  revalidateAdminViews();
}

export async function createOwnerCode(formData: FormData) {
  const ownerId = String(formData.get("ownerId"));
  const code = String(formData.get("code")).trim().toUpperCase();
  const label = String(formData.get("label")).trim();

  await prisma.ownerCode.create({
    data: {
      ownerId,
      code,
      label,
    },
  });

  revalidateAdminViews();
}

export async function updateOwnerName(formData: FormData) {
  let redirectPath = "/admin?status=success&message=Owner%20updated.";

  try {
    const ownerId = String(formData.get("ownerId") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    if (!ownerId || !name) {
      throw new Error("Owner name is required.");
    }

    const owner = await prisma.owner.findUnique({
      where: { id: ownerId },
    });

    if (!owner) {
      throw new Error("Owner not found.");
    }

    const duplicate = await prisma.owner.findFirst({
      where: {
        id: { not: owner.id },
        name,
      },
    });

    if (duplicate) {
      throw new Error(`Another owner is already named ${name}.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.owner.update({
        where: { id: owner.id },
        data: { name },
      });

      await tx.manager.updateMany({
        where: {
          OR: [{ code: owner.code }, { name: owner.name }],
        },
        data: {
          name,
          displayName: name,
        },
      });
    });

    revalidateAdminViews();
  } catch (error) {
    redirectPath = `/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not update owner.")}`;
  }

  redirect(redirectPath);
}

export async function saveStart2026DraftStateSnapshot() {
  let redirectPath = "/admin?status=success&message=Saved%20start%20of%202026%20draft%20snapshot.";

  try {
    const source = await getDraftStateSnapshotSource();
    const [draftSlots, keepers, settings, season] = await Promise.all([
      prisma.draftSlot.findMany({
        include: {
          selectedPlayer: true,
        },
        orderBy: { overallPickNumber: "asc" },
      }),
      prisma.keeper.findMany({
        include: {
          player: true,
          draftSlot: true,
        },
        orderBy: [{ ownerId: "asc" }, { playerName: "asc" }],
      }),
      prisma.leagueSettings.findFirst(),
      prisma.leagueSeason.findFirst({
        where: { year: 2026 },
        include: {
          drafts: {
            orderBy: { createdAt: "asc" },
            take: 1,
            include: {
              gridSlots: {
                orderBy: { overallPickNumber: "asc" },
                include: { player: true },
              },
            },
          },
        },
      }),
    ]);

    const draftGridSlots = season?.drafts[0]?.gridSlots ?? [];
    const savedAt = new Date().toISOString();

    await prisma.importedRecord.deleteMany({
      where: {
        recordType: "draft_state_snapshot",
        importKey: START_2026_SNAPSHOT_KEY,
      },
    });

    await prisma.importedRecord.create({
      data: {
        integrationSourceId: source.id,
        sourceType: IntegrationType.MANUAL_ENTRY,
        recordType: "draft_state_snapshot",
        importKey: START_2026_SNAPSHOT_KEY,
        rawPayload: {
          label: "Start of 2026",
          savedAt,
        },
        normalizedPayload: {
          label: "Start of 2026",
          year: 2026,
          savedAt,
          settings: settings
            ? {
                expectedTotalPlayersPerOwner: settings.expectedTotalPlayersPerOwner,
                totalRounds: settings.totalRounds,
                currentDraftRound: settings.currentDraftRound,
                currentDraftPick: settings.currentDraftPick,
              }
            : null,
          draftSlots: draftSlots.map((slot) => ({
            round: slot.round,
            slotNumber: slot.slotNumber,
            overallPickNumber: slot.overallPickNumber,
            defaultOwnerId: slot.defaultOwnerId,
            overrideOwnerCode: slot.overrideOwnerCode,
            currentOwnerId: slot.currentOwnerId,
            selectedPlayerName: slot.selectedPlayerName,
            selectedSport: slot.selectedSport,
            isKeeper: slot.isKeeper,
            originalRawValue: slot.originalRawValue,
            selectedAt: serializeDate(slot.selectedAt),
            selectedPlayer: slot.selectedPlayer
              ? {
                  normalizedName: slot.selectedPlayer.normalizedName,
                  displayName: slot.selectedPlayer.displayName,
                  sport: slot.selectedPlayer.sport,
                  metadata: slot.selectedPlayer.metadata,
                }
              : null,
          })),
          keepers: keepers.map((keeper) => ({
            ownerId: keeper.ownerId,
            playerName: keeper.playerName,
            sport: keeper.sport,
            tag: keeper.tag,
            originalValue: keeper.originalValue,
            draftSlotOverallPick: keeper.draftSlot?.overallPickNumber ?? null,
            player: keeper.player
              ? {
                  normalizedName: keeper.player.normalizedName,
                  displayName: keeper.player.displayName,
                  sport: keeper.player.sport,
                  metadata: keeper.player.metadata,
                }
              : null,
          })),
          draftGridSlots: draftGridSlots.map((slot) => ({
            round: slot.round,
            slotNumber: slot.slotNumber,
            overallPickNumber: slot.overallPickNumber,
            originalManagerId: slot.originalManagerId,
            currentManagerId: slot.currentManagerId,
            playerName: slot.playerName,
            sport: slot.sport,
            selectionType: slot.selectionType,
            keeperStatus: slot.keeperStatus,
            rawCellValue: slot.rawCellValue,
            notes: slot.notes,
            selectedAt: serializeDate(slot.selectedAt),
            player: slot.player
              ? {
                  normalizedName: slot.player.normalizedName,
                  displayName: slot.player.displayName,
                  sport: slot.player.sport,
                  metadata: slot.player.metadata,
                }
              : null,
          })),
        },
      },
    });

    revalidateAdminViews();
  } catch (error) {
    redirectPath = `/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not save draft snapshot.")}`;
  }

  redirect(redirectPath);
}

export async function restoreStart2026DraftStateSnapshot() {
  let redirectPath = "/admin?status=success&message=Restored%20start%20of%202026%20draft%20snapshot.";

  try {
    const snapshot = await prisma.importedRecord.findFirst({
      where: {
        recordType: "draft_state_snapshot",
        importKey: START_2026_SNAPSHOT_KEY,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!snapshot?.normalizedPayload || typeof snapshot.normalizedPayload !== "object" || Array.isArray(snapshot.normalizedPayload)) {
      throw new Error("No start of 2026 snapshot has been saved yet.");
    }

    const payload = snapshot.normalizedPayload as {
      settings?: {
        expectedTotalPlayersPerOwner: number | null;
        totalRounds: number;
        currentDraftRound: number | null;
        currentDraftPick: number | null;
      } | null;
      draftSlots?: Array<{
        round: number;
        slotNumber: number;
        overallPickNumber: number;
        defaultOwnerId: string;
        overrideOwnerCode: string | null;
        currentOwnerId: string;
        selectedPlayerName: string | null;
        selectedSport: Sport | null;
        isKeeper: boolean;
        originalRawValue: string | null;
        selectedAt: string | null;
        selectedPlayer?: {
          normalizedName: string;
          displayName: string;
          sport: Sport;
          metadata?: unknown;
        } | null;
      }>;
      keepers?: Array<{
        ownerId: string;
        playerName: string;
        sport: Sport;
        tag: string | null;
        originalValue: string | null;
        draftSlotOverallPick: number | null;
        player?: {
          normalizedName: string;
          displayName: string;
          sport: Sport;
          metadata?: unknown;
        } | null;
      }>;
      draftGridSlots?: Array<{
        overallPickNumber: number;
        currentManagerId: string;
        playerName: string | null;
        sport: Sport | null;
        selectionType: "OPEN" | "DRAFTED" | "KEEPER";
        keeperStatus: "K1" | "K2" | "K3" | "K4" | null;
        rawCellValue: string | null;
        notes: string | null;
        selectedAt: string | null;
        player?: {
          normalizedName: string;
          displayName: string;
          sport: Sport;
          metadata?: unknown;
        } | null;
      }>;
    };

    const draftSlots = payload.draftSlots ?? [];
    const draftGridSlots = payload.draftGridSlots ?? [];
    const keepers = payload.keepers ?? [];

    if (draftSlots.length === 0) {
      throw new Error("The saved snapshot does not include draft slots.");
    }

    if (payload.settings) {
      const existingSettings = await prisma.leagueSettings.findFirst();
      if (existingSettings) {
        await prisma.leagueSettings.update({
          where: { id: existingSettings.id },
          data: payload.settings,
        });
      } else {
        await prisma.leagueSettings.create({
          data: payload.settings,
        });
      }
    }

    await prisma.keeper.deleteMany();

    for (const slot of draftSlots) {
      const player =
        slot.selectedPlayerName && slot.selectedSport
          ? await prisma.player.upsert({
              where: { normalizedName: slot.selectedPlayer?.normalizedName ?? normalizePlayerName(slot.selectedPlayerName) },
              update: {
                displayName: slot.selectedPlayer?.displayName ?? slot.selectedPlayerName,
                sport: slot.selectedPlayer?.sport ?? slot.selectedSport,
                metadata: slot.selectedPlayer?.metadata ?? undefined,
              },
              create: {
                normalizedName: slot.selectedPlayer?.normalizedName ?? normalizePlayerName(slot.selectedPlayerName),
                displayName: slot.selectedPlayer?.displayName ?? slot.selectedPlayerName,
                sport: slot.selectedPlayer?.sport ?? slot.selectedSport,
                metadata: slot.selectedPlayer?.metadata ?? undefined,
              },
            })
          : null;

      await prisma.draftSlot.update({
        where: { overallPickNumber: slot.overallPickNumber },
        data: {
          round: slot.round,
          slotNumber: slot.slotNumber,
          defaultOwnerId: slot.defaultOwnerId,
          overrideOwnerCode: slot.overrideOwnerCode,
          currentOwnerId: slot.currentOwnerId,
          selectedPlayerId: player?.id ?? null,
          selectedPlayerName: slot.selectedPlayerName,
          selectedSport: slot.selectedSport,
          isKeeper: slot.isKeeper,
          originalRawValue: slot.originalRawValue,
          selectedAt: slot.selectedAt ? new Date(slot.selectedAt) : null,
        },
      });
    }

    const restoredDraftSlots = await prisma.draftSlot.findMany({
      select: { id: true, overallPickNumber: true },
    });
    const draftSlotIdByOverallPick = new Map(restoredDraftSlots.map((slot) => [slot.overallPickNumber, slot.id]));

    for (const keeper of keepers) {
      const player = await prisma.player.upsert({
        where: { normalizedName: keeper.player?.normalizedName ?? normalizePlayerName(keeper.playerName) },
        update: {
          displayName: keeper.player?.displayName ?? keeper.playerName,
          sport: keeper.player?.sport ?? keeper.sport,
          metadata: keeper.player?.metadata ?? undefined,
        },
        create: {
          normalizedName: keeper.player?.normalizedName ?? normalizePlayerName(keeper.playerName),
          displayName: keeper.player?.displayName ?? keeper.playerName,
          sport: keeper.player?.sport ?? keeper.sport,
          metadata: keeper.player?.metadata ?? undefined,
        },
      });

      await prisma.keeper.create({
        data: {
          ownerId: keeper.ownerId,
          playerId: player.id,
          playerName: keeper.playerName,
          sport: keeper.sport,
          tag: keeper.tag,
          originalValue: keeper.originalValue,
          draftSlotId: keeper.draftSlotOverallPick ? draftSlotIdByOverallPick.get(keeper.draftSlotOverallPick) : null,
        },
      });
    }

    const season = await prisma.leagueSeason.findFirst({
      where: { year: 2026 },
      include: {
        drafts: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });
    const draft = season?.drafts[0];

    if (draft && draftGridSlots.length > 0) {
      const existingGridSlots = await prisma.draftGridSlot.findMany({
        where: { draftId: draft.id },
        select: { id: true, overallPickNumber: true },
      });
      const gridSlotIdByOverallPick = new Map(existingGridSlots.map((slot) => [slot.overallPickNumber, slot.id]));

      for (const slot of draftGridSlots) {
        const gridSlotId = gridSlotIdByOverallPick.get(slot.overallPickNumber);

        if (!gridSlotId) {
          continue;
        }

        const player =
          slot.playerName && slot.sport
            ? await prisma.player.upsert({
                where: { normalizedName: slot.player?.normalizedName ?? normalizePlayerName(slot.playerName) },
                update: {
                  displayName: slot.player?.displayName ?? slot.playerName,
                  sport: slot.player?.sport ?? slot.sport,
                  metadata: slot.player?.metadata ?? undefined,
                },
                create: {
                  normalizedName: slot.player?.normalizedName ?? normalizePlayerName(slot.playerName),
                  displayName: slot.player?.displayName ?? slot.playerName,
                  sport: slot.player?.sport ?? slot.sport,
                  metadata: slot.player?.metadata ?? undefined,
                },
              })
            : null;

        await prisma.draftGridSlot.update({
          where: { id: gridSlotId },
          data: {
            currentManagerId: slot.currentManagerId,
            playerId: player?.id ?? null,
            playerName: slot.playerName,
            sport: slot.sport,
            selectionType: slot.selectionType,
            keeperStatus: slot.keeperStatus,
            rawCellValue: slot.rawCellValue,
            notes: slot.notes,
            selectedAt: slot.selectedAt ? new Date(slot.selectedAt) : null,
          },
        });
      }
    }

    revalidateAdminViews();
  } catch (error) {
    redirectPath = `/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not restore draft snapshot.")}`;
  }

  redirect(redirectPath);
}

export async function importSpreadsheetText(formData: FormData) {
  const input = String(formData.get("importText") ?? "");
  const rows = parseImportText(input);
  await importSheetRows(rows);
  revalidateAdminViews();
}

export async function saveKeeperGoogleSheetSource(formData: FormData) {
  try {
    const config = parseGoogleSheetConfigFormData(formData);

    await saveGoogleSheetSourceConfig(config);

    revalidateAdminViews();
    redirect("/admin?status=success&message=Sheet%20config%20saved.");
  } catch (error) {
    redirect(`/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not save sheet config.")}`);
  }
}

export async function syncKeeperGoogleSheetSource() {
  const config = await getGoogleSheetSourceConfig();

  if (!config?.spreadsheetUrl) {
    throw new Error("Configure a Google Sheet source URL first.");
  }

  await syncLeagueFromKeeperGoogleSheet(config);
  revalidateAdminViews();
}

export async function syncKeeperGoogleSheetSourceFromForm(formData: FormData) {
  try {
    const config = parseGoogleSheetConfigFormData(formData);

    const result = await syncLeagueFromKeeperGoogleSheet(config);
    await saveGoogleSheetSourceConfig(config);
    revalidateAdminViews();

    redirect(
      `/admin?status=success&message=${encodeURIComponent(
        `Sheet sync complete. Imported ${result.importedKeepers} keepers and ${result.importedOverrides} overrides.`,
      )}`,
    );
  } catch (error) {
    redirect(`/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not sync Google Sheet source.")}`);
  }
}

export async function pushDraftBoardToKeeperGoogleSheet() {
  await pushFullDraftBoardToGoogleSheetWebhook();
}

export async function resetDemoData() {
  if (process.env.VERCEL) {
    throw new Error("Reset and reseed demo data is disabled in the hosted app.");
  }

  const [{ execFile }, { promisify }] = await Promise.all([import("node:child_process"), import("node:util")]);
  const execFileAsync = promisify(execFile);

  await execFileAsync("/Users/michaelzoltek/Library/pnpm/pnpm", ["db:seed"], {
    cwd: process.cwd(),
    env: process.env,
  });
  revalidateAdminViews();
}

function parseGoogleSheetConfigFormData(formData: FormData) {
  const spreadsheetUrl = String(formData.get("spreadsheetUrl") ?? "").trim();
  const writebackWebhookUrl = String(formData.get("writebackWebhookUrl") ?? "").trim();
  const draftViewSheetName = String(formData.get("draftViewSheetName") ?? "").trim();
  const picksSheetName = String(formData.get("picksSheetName") ?? "").trim();

  if (!spreadsheetUrl) {
    throw new Error("Spreadsheet URL is required.");
  }

  return {
    spreadsheetUrl,
    writebackWebhookUrl: writebackWebhookUrl || null,
    draftViewSheetName: draftViewSheetName || "Draft View",
    picksSheetName: picksSheetName || "Picks",
  };
}
