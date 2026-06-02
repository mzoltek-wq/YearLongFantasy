import { NextResponse } from "next/server";

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

export async function GET(request: Request) {
  const snapshot = await getLeagueSnapshot();
  const url = new URL(request.url);
  const view = url.searchParams.get("view");

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
