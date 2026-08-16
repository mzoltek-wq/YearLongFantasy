import { DraftSelectionType, KeeperStatus } from "@prisma/client";

import type { DraftHistoryGridProps, DraftHistorySlot } from "@/components/league/draft-history-grid";
import { prisma } from "@/lib/db/prisma";

function normalizePersonKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeKeeperStatus(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.toUpperCase();
  return Object.values(KeeperStatus).includes(normalized as KeeperStatus) ? (normalized as KeeperStatus) : null;
}

export async function getDraftHistoryGridData(year: number): Promise<DraftHistoryGridProps | null> {
  const [availableYears, season] = await Promise.all([
    prisma.leagueSeason.findMany({
      select: { year: true },
      orderBy: { year: "desc" },
    }),
    prisma.leagueSeason.findFirst({
      where: { year },
      include: {
        league: true,
        seasonManagers: {
          include: { manager: true },
          orderBy: { slotNumber: "asc" },
        },
        drafts: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    }),
  ]);

  if (!season || season.drafts.length === 0) {
    return null;
  }

  const draft = season.drafts[0];
  const [gridSlots, liveSlots] = await Promise.all([
    prisma.draftGridSlot.findMany({
      where: { draftId: draft.id },
      include: {
        currentManager: true,
        originalManager: true,
      },
      orderBy: [{ round: "asc" }, { slotNumber: "asc" }],
    }),
    prisma.draftSlot.findMany({
      include: {
        currentOwner: true,
        defaultOwner: true,
        keeper: true,
      },
      orderBy: { overallPickNumber: "asc" },
    }),
  ]);

  const managerColumns = season.seasonManagers.map((entry) => entry.manager);
  const liveSlotByOverallPick = new Map(liveSlots.map((slot) => [slot.overallPickNumber, slot]));
  const managerByOwnerId = new Map<string, (typeof managerColumns)[number]>();
  const shouldOverlayLiveDraft = season.status !== "ARCHIVED";

  for (const liveSlot of liveSlots) {
    const owner = liveSlot.currentOwner;
    const ownerNameKey = normalizePersonKey(owner.name);
    const manager =
      managerColumns.find((entry) => entry.code.toUpperCase() === owner.code.toUpperCase()) ??
      managerColumns.find((entry) => normalizePersonKey(entry.name) === ownerNameKey || normalizePersonKey(entry.displayName ?? "") === ownerNameKey) ??
      managerColumns.find((entry) => normalizePersonKey(entry.name).startsWith(ownerNameKey) || ownerNameKey.startsWith(normalizePersonKey(entry.name))) ??
      managerColumns.find((entry) => {
        const displayKey = normalizePersonKey(entry.displayName ?? "");
        return Boolean(displayKey) && (displayKey.startsWith(ownerNameKey) || ownerNameKey.startsWith(displayKey));
      });

    if (manager) {
      managerByOwnerId.set(owner.id, manager);
    }
  }

  const slots: DraftHistorySlot[] = gridSlots.map((slot) => {
    const liveSlot = liveSlotByOverallPick.get(slot.overallPickNumber);
    const liveCurrentManager = liveSlot && shouldOverlayLiveDraft ? managerByOwnerId.get(liveSlot.currentOwnerId) : null;
    const livePlayerName = liveSlot?.selectedPlayerName ?? null;
    const playerName = shouldOverlayLiveDraft && liveSlot ? livePlayerName : slot.playerName;
    const liveSelectionType = livePlayerName ? (liveSlot?.isKeeper ? DraftSelectionType.KEEPER : DraftSelectionType.DRAFTED) : DraftSelectionType.OPEN;
    const selectionType = shouldOverlayLiveDraft && liveSlot ? liveSelectionType : slot.selectionType;
    const sport = shouldOverlayLiveDraft && liveSlot ? (liveSlot.selectedSport ?? null) : slot.sport;
    const keeperStatus = shouldOverlayLiveDraft && liveSlot ? normalizeKeeperStatus(liveSlot.keeper?.tag) : slot.keeperStatus;
    const currentManager = liveCurrentManager ?? slot.currentManager;

    return {
      id: slot.id,
      round: slot.round,
      slotNumber: slot.slotNumber,
      overallPickNumber: slot.overallPickNumber,
      originalManagerId: slot.originalManagerId,
      currentManagerId: currentManager.id,
      currentManagerName: currentManager.displayName ?? currentManager.name,
      currentManagerCode: currentManager.code,
      playerName,
      sport,
      selectionType,
      keeperStatus,
      source: shouldOverlayLiveDraft && liveSlot ? "live-draft" : "draft-grid",
    };
  });

  return {
    availableYears: availableYears.map((entry) => entry.year),
    managerColumns: managerColumns.map((manager) => ({
      id: manager.id,
      name: manager.name,
      displayName: manager.displayName,
      code: manager.code,
    })),
    roundCount: season.roundCount,
    seasonName: season.name,
    selectedCount: slots.filter((slot) => slot.selectionType !== DraftSelectionType.OPEN).length,
    selectedYear: year,
    slots,
    tradedPickCount: slots.filter((slot) => slot.currentManagerId !== slot.originalManagerId).length,
  };
}
