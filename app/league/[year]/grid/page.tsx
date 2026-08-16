import { notFound } from "next/navigation";
import { DraftSelectionType, KeeperStatus } from "@prisma/client";

import { DraftHistoryGrid, type DraftHistorySlot } from "@/components/league/draft-history-grid";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

function normalizeKeeperStatus(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.toUpperCase();
  return Object.values(KeeperStatus).includes(normalized as KeeperStatus) ? (normalized as KeeperStatus) : null;
}

export default async function LeagueGridPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams?: Promise<{ status?: string; message?: string }>;
}) {
  const { year: yearParam } = await params;
  const feedback = await searchParams;
  const year = Number(yearParam);

  if (!Number.isInteger(year)) {
    notFound();
  }

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
    notFound();
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
  const slots: DraftHistorySlot[] = gridSlots.map((slot) => {
    const liveSlot = liveSlotByOverallPick.get(slot.overallPickNumber);
    const livePlayerName = liveSlot?.selectedPlayerName ?? null;
    const playerName = slot.playerName ?? livePlayerName;
    const liveSelectionType = livePlayerName ? (liveSlot?.isKeeper ? DraftSelectionType.KEEPER : DraftSelectionType.DRAFTED) : DraftSelectionType.OPEN;
    const selectionType = slot.selectionType !== DraftSelectionType.OPEN ? slot.selectionType : liveSelectionType;
    const sport = slot.sport ?? liveSlot?.selectedSport ?? null;
    const keeperStatus = slot.keeperStatus ?? normalizeKeeperStatus(liveSlot?.keeper?.tag);

    return {
      id: slot.id,
      round: slot.round,
      slotNumber: slot.slotNumber,
      overallPickNumber: slot.overallPickNumber,
      originalManagerId: slot.originalManagerId,
      currentManagerId: slot.currentManagerId,
      currentManagerName: slot.currentManager.displayName ?? slot.currentManager.name,
      currentManagerCode: slot.currentManager.code,
      playerName,
      sport,
      selectionType,
      keeperStatus,
      source: slot.playerName ? "draft-grid" : livePlayerName ? "live-draft" : "draft-grid",
    };
  });

  const selectedCount = slots.filter((slot) => slot.selectionType !== DraftSelectionType.OPEN).length;
  const tradedPickCount = slots.filter((slot) => slot.currentManagerId !== slot.originalManagerId).length;

  return (
    <div className="space-y-6">
      {feedback?.message ? (
        <Card className={feedback.status === "error" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}>
          <p className={`text-sm font-medium ${feedback.status === "error" ? "text-rose-900" : "text-emerald-900"}`}>{feedback.message}</p>
        </Card>
      ) : null}

      <DraftHistoryGrid
        availableYears={availableYears.map((entry) => entry.year)}
        managerColumns={managerColumns.map((manager) => ({
          id: manager.id,
          name: manager.name,
          displayName: manager.displayName,
          code: manager.code,
        }))}
        roundCount={season.roundCount}
        seasonName={season.name}
        selectedCount={selectedCount}
        selectedYear={year}
        slots={slots}
        tradedPickCount={tradedPickCount}
      />
    </div>
  );
}
