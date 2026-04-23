import { NextResponse } from "next/server";

import { getLeagueSnapshot } from "@/lib/draft/service";

export async function GET() {
  const snapshot = await getLeagueSnapshot();
  const header = ["overallPickNumber", "round", "slotNumber", "defaultOwner", "currentOwner", "overrideOwnerCode", "playerName", "sport", "isKeeper"];
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
  ]);

  const csv = [header, ...rows].map((row) => row.join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="league-export.csv"',
    },
  });
}
