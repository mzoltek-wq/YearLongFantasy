import { notFound } from "next/navigation";

import { importV2TradedPicksText } from "@/components/league/league-actions";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { SPORT_EMOJIS, SPORT_LABELS } from "@/lib/constants/league";

export const dynamic = "force-dynamic";

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

  const season = await prisma.leagueSeason.findFirst({
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
  });

  if (!season || season.drafts.length === 0) {
    notFound();
  }

  const draft = season.drafts[0];
  const slots = await prisma.draftGridSlot.findMany({
    where: { draftId: draft.id },
    include: {
      currentManager: true,
      originalManager: true,
    },
    orderBy: [{ round: "asc" }, { slotNumber: "asc" }],
  });

  const managerColumns = season.seasonManagers.map((entry) => entry.manager);
  const slotsByRoundAndOriginalManager = new Map<string, (typeof slots)[number]>();

  for (const slot of slots) {
    slotsByRoundAndOriginalManager.set(`${slot.round}:${slot.originalManagerId}`, slot);
  }

  const selectedCount = slots.filter((slot) => slot.selectionType !== "OPEN").length;
  const tradedPickCount = slots.filter((slot) => slot.currentManagerId !== slot.originalManagerId).length;

  return (
    <div className="space-y-6">
      {feedback?.message ? (
        <Card className={feedback.status === "error" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}>
          <p className={`text-sm font-medium ${feedback.status === "error" ? "text-rose-900" : "text-emerald-900"}`}>{feedback.message}</p>
        </Card>
      ) : null}

      <Card>
        <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">League v2</p>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold">{season.name} draft grid</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              This is the new canonical grid model: each cell tracks original pick owner, current pick owner,
              player, sport, and keeper status.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Rounds</p>
              <p className="text-2xl font-semibold">{season.roundCount}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Selected</p>
              <p className="text-2xl font-semibold">{selectedCount}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Moved</p>
              <p className="text-2xl font-semibold">{tradedPickCount}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-xl font-semibold">Import current draft pick ownership</h3>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              Paste the mostly blank current-year draft grid from Google Sheets. Blank cells reset to the original pick owner;
              cells like <span className="font-mono">(MZ)</span> move that original owner&apos;s pick to the manager code in the cell.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold">
            Current import target: {year}
          </div>
        </div>
        <form action={importV2TradedPicksText} className="mt-4 space-y-3">
          <input name="year" type="hidden" value={year} />
          <textarea
            className="min-h-44 w-full rounded-2xl border border-[var(--border)] px-4 py-3 font-mono text-sm"
            name="tradedPicksText"
            placeholder={"Matt\tZolt\tMac\tHoff\n\t\t(JR)\n\t\t(RH)\n13\t\t\t(MZ)"}
          />
          <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
            Import pick ownership grid
          </button>
        </form>
      </Card>

      <div className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--surface-strong)] text-left">
                <th className="sticky left-0 z-20 border-b border-r border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 font-semibold">
                  Round
                </th>
                {managerColumns.map((manager) => (
                  <th className="min-w-56 border-b border-r border-[var(--border)] px-4 py-3 font-semibold" key={manager.id}>
                    <div>{manager.displayName ?? manager.name}</div>
                    <div className="text-xs font-medium text-[var(--muted)]">{manager.code}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: season.roundCount }, (_, index) => index + 1).map((round) => (
                <tr className="align-top" key={round}>
                  <th className="sticky left-0 z-10 border-b border-r border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-left font-semibold">
                    {round}
                  </th>
                  {managerColumns.map((manager) => {
                    const slot = slotsByRoundAndOriginalManager.get(`${round}:${manager.id}`);

                    if (!slot) {
                      return (
                        <td className="border-b border-r border-[var(--border)] px-4 py-4 text-[var(--muted)]" key={manager.id}>
                          Missing slot
                        </td>
                      );
                    }

                    const hasPickMoved = slot.currentManagerId !== slot.originalManagerId;
                    const sportLabel = slot.sport ? `${SPORT_EMOJIS[slot.sport]} ${SPORT_LABELS[slot.sport]}` : null;

                    return (
                      <td className="border-b border-r border-[var(--border)] px-4 py-4" key={slot.id}>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[var(--muted)]">Pick {slot.overallPickNumber}</span>
                            {hasPickMoved ? (
                              <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">
                                {slot.currentManager.code}
                              </span>
                            ) : null}
                          </div>

                          {slot.playerName ? (
                            <div>
                              <p className="font-semibold">{slot.playerName}</p>
                              <p className="text-xs text-[var(--muted)]">
                                {[sportLabel, slot.keeperStatus].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                          ) : (
                            <p className="text-[var(--muted)]">{hasPickMoved ? `${slot.currentManager.name} owns this pick` : "Open"}</p>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
