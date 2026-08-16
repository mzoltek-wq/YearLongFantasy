import { NextResponse } from "next/server";

import { getLeagueSnapshot } from "@/lib/draft/service";
import { getDraftHistoryGridData } from "@/lib/league/draft-history";

export const dynamic = "force-dynamic";

export async function GET() {
  const year = new Date().getFullYear();
  const [draftSnapshot, draftHistory] = await Promise.all([getLeagueSnapshot(), getDraftHistoryGridData(year)]);

  return NextResponse.json(
    {
      draftSnapshot,
      draftHistory,
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
