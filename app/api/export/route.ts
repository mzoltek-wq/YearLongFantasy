import { NextResponse } from "next/server";
import { Sport } from "@prisma/client";

import { SPORT_EMOJIS } from "@/lib/constants/league";
import { getLeagueSnapshot } from "@/lib/draft/service";

function csvEscape(value: unknown) {
  const stringValue = String(value ?? "");

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function tsvEscape(value: unknown) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function toTsv(rows: unknown[][]) {
  return rows.map((row) => row.map(tsvEscape).join("\t")).join("\n");
}

function formatKeeperSheetCell(slot: Awaited<ReturnType<typeof getLeagueSnapshot>>["slots"][number]) {
  if (!slot.selectedPlayerName && !slot.overrideOwnerCode) {
    return "";
  }

  const ownerPrefix = slot.overrideOwnerCode ? `(${slot.currentOwner.code}) ` : "";
  const sportPrefix = slot.selectedSport ? `${SPORT_EMOJIS[slot.selectedSport as Sport]} ` : "";
  const playerName = slot.selectedPlayerName ?? "";
  const keeperTag = slot.keeper?.tag ? ` (${slot.keeper.tag})` : "";

  return `${sportPrefix}${ownerPrefix}${playerName}${keeperTag}`.trim();
}

export async function GET(request: Request) {
  const snapshot = await getLeagueSnapshot();
  const url = new URL(request.url);
  const view = url.searchParams.get("view");

  if (view === "keeper-grid") {
    const roundOneSlots = snapshot.slots.filter((slot) => slot.round === 1).sort((left, right) => left.slotNumber - right.slotNumber);
    const orderedOwners = roundOneSlots.length === snapshot.owners.length ? roundOneSlots.map((slot) => slot.defaultOwner) : snapshot.owners;
    const maxRound = snapshot.settings.totalRounds;
    const slotsByRoundAndOwner = new Map(snapshot.slots.map((slot) => [`${slot.round}:${slot.defaultOwnerId}`, slot]));
    const rows = [
      ["Round", ...orderedOwners.map((owner) => owner.name)],
      ...Array.from({ length: maxRound }, (_, index) => {
        const round = index + 1;

        return [
          round,
          ...orderedOwners.map((owner) => {
            const slot = slotsByRoundAndOwner.get(`${round}:${owner.id}`);
            return slot ? formatKeeperSheetCell(slot) : "";
          }),
        ];
      }),
    ];

    return new NextResponse(toTsv(rows), {
      headers: {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": 'attachment; filename="keeper-grid-export.tsv"',
      },
    });
  }

  if (view === "rosters") {
    const header = ["owner", "sport", "playerName", "round", "overallPickNumber", "type", "keeperTag", "originalRawValue"];
    const rows = snapshot.slots
      .filter((slot) => slot.selectedPlayerName)
      .sort((left, right) => left.currentOwner.name.localeCompare(right.currentOwner.name) || String(left.selectedSport).localeCompare(String(right.selectedSport)) || left.overallPickNumber - right.overallPickNumber)
      .map((slot) => [
        slot.currentOwner.name,
        slot.selectedSport ?? "",
        slot.selectedPlayerName ?? "",
        slot.round,
        slot.overallPickNumber,
        slot.isKeeper ? "Keeper" : "Draft Pick",
        slot.keeper?.tag ?? "",
        slot.originalRawValue ?? "",
      ]);

    return new NextResponse(toCsv([header, ...rows]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="league-rosters-export.csv"',
      },
    });
  }

  const header = [
    "overallPickNumber",
    "round",
    "slotNumber",
    "defaultOwner",
    "currentOwner",
    "overrideOwnerCode",
    "playerName",
    "sport",
    "isKeeper",
    "keeperTag",
    "originalRawValue",
  ];
  const rows = snapshot.slots.map((slot) => [
    slot.overallPickNumber,
    slot.round,
    slot.slotNumber,
    slot.defaultOwner.name,
    slot.currentOwner.name,
    slot.overrideOwnerCode ?? "",
    slot.selectedPlayerName ?? "",
    slot.selectedSport ?? "",
    slot.isKeeper ? "TRUE" : "FALSE",
    slot.keeper?.tag ?? "",
    slot.originalRawValue ?? "",
  ]);

  return new NextResponse(toCsv([header, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="league-export.csv"',
    },
  });
}
