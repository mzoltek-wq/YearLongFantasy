"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DraftSelectionType, IntegrationType, PickChangeSource, Prisma, Sport } from "@prisma/client";

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

async function findOwnerForManager(tx: Prisma.TransactionClient, managerId: string) {
  const manager = await tx.manager.findUnique({
    where: { id: managerId },
  });

  if (!manager) {
    return null;
  }

  const owners = await tx.owner.findMany();
  const managerNameKey = normalizePersonKey(manager.name);
  const managerDisplayKey = normalizePersonKey(manager.displayName ?? "");

  return (
    owners.find((owner) => owner.code.toUpperCase() === manager.code.toUpperCase()) ??
    owners.find((owner) => normalizePersonKey(owner.name) === managerNameKey || normalizePersonKey(owner.name) === managerDisplayKey) ??
    owners.find((owner) => normalizePersonKey(owner.name).startsWith(managerNameKey) || managerNameKey.startsWith(normalizePersonKey(owner.name))) ??
    owners.find((owner) => {
      return Boolean(managerDisplayKey) && (normalizePersonKey(owner.name).startsWith(managerDisplayKey) || managerDisplayKey.startsWith(normalizePersonKey(owner.name)));
    }) ??
    null
  );
}

type SwappableLiveSlot = Awaited<
  ReturnType<
    Prisma.TransactionClient["draftSlot"]["findMany"]
  >
>[number] & {
  defaultOwner: {
    code: string;
    name: string;
  };
};

type SwappableGridSlot = Awaited<
  ReturnType<
    Prisma.TransactionClient["draftGridSlot"]["findMany"]
  >
>[number] & {
  originalManager: {
    code: string;
    displayName: string | null;
    name: string;
  };
};

function parseOptionalPickNumber(formData: FormData, key: string) {
  const rawValue = String(formData.get(key) ?? "").trim();

  if (!rawValue) {
    return null;
  }

  const pickNumber = Number(rawValue);
  return Number.isInteger(pickNumber) && pickNumber > 0 ? pickNumber : null;
}

function resolveLiveRoundPick({
  slots,
  exactOverallPickNumber,
  ownerName,
  round,
}: {
  slots: SwappableLiveSlot[];
  exactOverallPickNumber: number | null;
  ownerName: string;
  round: number;
}) {
  if (exactOverallPickNumber) {
    const exactSlot = slots.find((slot) => slot.overallPickNumber === exactOverallPickNumber);

    if (!exactSlot) {
      throw new Error(`${ownerName} does not currently own overall pick ${exactOverallPickNumber} in round ${round}.`);
    }

    return exactSlot;
  }

  if (slots.length === 0) {
    throw new Error(`${ownerName} does not currently own an open or used pick in round ${round}.`);
  }

  if (slots.length > 1) {
    const choices = slots
      .map((slot) => `overall ${slot.overallPickNumber} (${slot.defaultOwner.code}'s original pick)`)
      .join(", ");
    throw new Error(`${ownerName} owns multiple picks in round ${round}: ${choices}. Choose the exact pick and try again.`);
  }

  return slots[0];
}

function resolveGridRoundPick({
  slots,
  exactOverallPickNumber,
  ownerName,
  round,
  year,
}: {
  slots: SwappableGridSlot[];
  exactOverallPickNumber: number | null;
  ownerName: string;
  round: number;
  year: number;
}) {
  if (exactOverallPickNumber) {
    const exactSlot = slots.find((slot) => slot.overallPickNumber === exactOverallPickNumber);

    if (!exactSlot) {
      throw new Error(`${ownerName} does not currently own overall pick ${exactOverallPickNumber} in round ${round} of the ${year} grid.`);
    }

    return exactSlot;
  }

  if (slots.length === 0) {
    throw new Error(`${ownerName} does not currently own a ${year} draft-grid pick in round ${round}.`);
  }

  if (slots.length > 1) {
    const choices = slots
      .map((slot) => `overall ${slot.overallPickNumber} (${slot.originalManager.code}'s original pick)`)
      .join(", ");
    throw new Error(`${ownerName} owns multiple ${year} picks in round ${round}: ${choices}. Choose the exact pick and try again.`);
  }

  return slots[0];
}

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function swapDraftPickOwnership(formData: FormData) {
  let redirectPath = "/admin?status=success&message=Draft%20picks%20swapped.";

  try {
    const year = Number(formData.get("year"));
    const leftOwnerId = String(formData.get("leftOwnerId") ?? "");
    const rightOwnerId = String(formData.get("rightOwnerId") ?? "");
    const leftRound = Number(formData.get("leftRound"));
    const rightRound = Number(formData.get("rightRound"));
    const leftOverallPickNumber = parseOptionalPickNumber(formData, "leftOverallPickNumber");
    const rightOverallPickNumber = parseOptionalPickNumber(formData, "rightOverallPickNumber");
    const notes = String(formData.get("notes") ?? "").trim();

    if (!Number.isInteger(year)) {
      throw new Error("Choose a valid draft year.");
    }

    if (!leftOwnerId || !rightOwnerId) {
      throw new Error("Both owners are required.");
    }

    if (!Number.isInteger(leftRound) || leftRound <= 0 || !Number.isInteger(rightRound) || rightRound <= 0) {
      throw new Error("Both rounds must be positive whole numbers.");
    }

    if (leftOwnerId === rightOwnerId && leftRound === rightRound) {
      throw new Error("Choose two different owner/round picks.");
    }

    await prisma.$transaction(
      async (tx) => {
        const [leftOwner, rightOwner, season] = await Promise.all([
          tx.owner.findUnique({ where: { id: leftOwnerId } }),
          tx.owner.findUnique({ where: { id: rightOwnerId } }),
          tx.leagueSeason.findFirst({
            where: { year },
            include: {
              drafts: {
                orderBy: { createdAt: "asc" },
                take: 1,
              },
            },
          }),
        ]);

        if (!leftOwner || !rightOwner) {
          throw new Error("Could not find one of those owners.");
        }

        if (!season) {
          throw new Error(`Could not find a ${year} season/draft grid.`);
        }

        const draft = season.drafts[0];

        if (!draft) {
          throw new Error(`Could not find a ${year} draft grid.`);
        }

        const [leftManager, rightManager] = await Promise.all([
          findManagerForOwnerId(tx, leftOwner.id),
          findManagerForOwnerId(tx, rightOwner.id),
        ]);

        if (!leftManager || !rightManager) {
          throw new Error("Could not map one of those owners to the draft grid manager records.");
        }

        const swapNotes =
          notes ||
          `Manual ${year} pick swap: ${leftOwner.name} round ${leftRound} for ${rightOwner.name} round ${rightRound}.`;

        if (year === CURRENT_DRAFT_GRID_YEAR) {
          const [leftSlots, rightSlots, leftNewOwnerCode, rightNewOwnerCode] = await Promise.all([
            tx.draftSlot.findMany({
              where: {
                round: leftRound,
                currentOwnerId: leftOwner.id,
              },
              include: {
                currentOwner: true,
                defaultOwner: true,
              },
            }),
            tx.draftSlot.findMany({
              where: {
                round: rightRound,
                currentOwnerId: rightOwner.id,
              },
              include: {
                currentOwner: true,
                defaultOwner: true,
              },
            }),
            tx.ownerCode.findFirst({
              where: { ownerId: rightOwner.id },
              orderBy: { createdAt: "asc" },
            }),
            tx.ownerCode.findFirst({
              where: { ownerId: leftOwner.id },
              orderBy: { createdAt: "asc" },
            }),
          ]);

          const leftSlot = resolveLiveRoundPick({
            slots: leftSlots,
            exactOverallPickNumber: leftOverallPickNumber,
            ownerName: leftOwner.name,
            round: leftRound,
          });
          const rightSlot = resolveLiveRoundPick({
            slots: rightSlots,
            exactOverallPickNumber: rightOverallPickNumber,
            ownerName: rightOwner.name,
            round: rightRound,
          });

          if (leftSlot.selectedPlayerName || rightSlot.selectedPlayerName) {
            throw new Error("Only unused/open picks can be swapped. One of those owner-round picks is already filled.");
          }

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

          const [leftGridSlot, rightGridSlot] = await Promise.all([
            tx.draftGridSlot.findUnique({
              where: {
                draftId_overallPickNumber: {
                  draftId: draft.id,
                  overallPickNumber: leftSlot.overallPickNumber,
                },
              },
            }),
            tx.draftGridSlot.findUnique({
              where: {
                draftId_overallPickNumber: {
                  draftId: draft.id,
                    overallPickNumber: rightSlot.overallPickNumber,
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

          return;
        }

        const [leftGridSlots, rightGridSlots] = await Promise.all([
          tx.draftGridSlot.findMany({
            where: {
              draftId: draft.id,
              round: leftRound,
              currentManagerId: leftManager.id,
            },
            include: {
              originalManager: true,
            },
          }),
          tx.draftGridSlot.findMany({
            where: {
              draftId: draft.id,
              round: rightRound,
              currentManagerId: rightManager.id,
            },
            include: {
              originalManager: true,
            },
          }),
        ]);

        const leftGridSlot = resolveGridRoundPick({
          slots: leftGridSlots,
          exactOverallPickNumber: leftOverallPickNumber,
          ownerName: leftOwner.name,
          round: leftRound,
          year,
        });
        const rightGridSlot = resolveGridRoundPick({
          slots: rightGridSlots,
          exactOverallPickNumber: rightOverallPickNumber,
          ownerName: rightOwner.name,
          round: rightRound,
          year,
        });

        if (leftGridSlot.playerName || rightGridSlot.playerName || leftGridSlot.selectionType !== DraftSelectionType.OPEN || rightGridSlot.selectionType !== DraftSelectionType.OPEN) {
          throw new Error("Only unused/open future picks can be swapped. One of those owner-round picks is already filled.");
        }

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
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    revalidateAdminViews();
    revalidatePath(`/league/${year}/grid`);
  } catch (error) {
    redirectPath = `/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not swap draft picks.")}`;
  }

  redirect(redirectPath);
}

export async function undoDraftPickOwnershipSwap(formData: FormData) {
  let redirectPath = "/admin?status=success&message=Pick%20swap%20undone.";

  try {
    const changeIds = String(formData.get("changeIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (changeIds.length !== 2) {
      throw new Error("Choose a valid two-pick swap to undo.");
    }

    await prisma.$transaction(
      async (tx) => {
        const changes = await tx.pickOwnershipChange.findMany({
          where: {
            id: {
              in: changeIds,
            },
          },
          include: {
            season: true,
            draftGridSlot: true,
            fromManager: true,
            toManager: true,
          },
        });

        if (changes.length !== 2) {
          throw new Error("Could not find both sides of that pick swap.");
        }

        const [firstChange, secondChange] = changes;
        if (firstChange.seasonId !== secondChange.seasonId) {
          throw new Error("Those pick changes are not from the same season.");
        }

        for (const change of changes) {
          const slot = change.draftGridSlot;

          if (slot.playerName || slot.selectionType !== DraftSelectionType.OPEN) {
            throw new Error(`Cannot undo this swap because overall pick ${slot.overallPickNumber} is already filled.`);
          }

          if (slot.currentManagerId !== change.toManagerId) {
            throw new Error(`Cannot undo this swap because overall pick ${slot.overallPickNumber} has changed owners again.`);
          }
        }

        await Promise.all(
          changes.map((change) =>
            tx.draftGridSlot.update({
              where: { id: change.draftGridSlotId },
              data: {
                currentManagerId: change.fromManagerId,
                notes: [change.draftGridSlot.notes, `Undo: ${change.notes ?? "manual pick swap"}`].filter(Boolean).join("\n"),
              },
            }),
          ),
        );

        if (firstChange.season.year === CURRENT_DRAFT_GRID_YEAR) {
          const ownerPairs = await Promise.all(
            changes.map(async (change) => {
              const owner = await findOwnerForManager(tx, change.fromManagerId);
              const ownerCode = owner
                ? await tx.ownerCode.findFirst({
                    where: { ownerId: owner.id },
                    orderBy: { createdAt: "asc" },
                  })
                : null;

              return {
                change,
                owner,
                ownerCode,
              };
            }),
          );

          for (const { change, owner, ownerCode } of ownerPairs) {
            if (!owner) {
              throw new Error(`Could not map ${change.fromManager.displayName ?? change.fromManager.name} back to a live draft owner.`);
            }

            const liveSlot = await tx.draftSlot.findUnique({
              where: { overallPickNumber: change.draftGridSlot.overallPickNumber },
            });

            if (!liveSlot) {
              throw new Error(`Could not find live draft pick ${change.draftGridSlot.overallPickNumber}.`);
            }

            if (liveSlot.selectedPlayerName) {
              throw new Error(`Cannot undo this swap because live pick ${liveSlot.overallPickNumber} is already filled.`);
            }

            await tx.draftSlot.update({
              where: { id: liveSlot.id },
              data: {
                currentOwnerId: owner.id,
                overrideOwnerCode: owner.id === liveSlot.defaultOwnerId ? null : (ownerCode?.code ?? owner.code),
              },
            });
          }
        }

        await tx.pickOwnershipChange.createMany({
          data: changes.map((change) => ({
            seasonId: change.seasonId,
            draftGridSlotId: change.draftGridSlotId,
            fromManagerId: change.toManagerId,
            toManagerId: change.fromManagerId,
            source: PickChangeSource.MANUAL,
            notes: `Undo: ${change.notes ?? "manual pick swap"}`,
            approvedAt: new Date(),
          })),
        });

        revalidatePath(`/league/${firstChange.season.year}/grid`);
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    revalidateAdminViews();
  } catch (error) {
    redirectPath = `/admin?status=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Could not undo that pick swap.")}`;
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
