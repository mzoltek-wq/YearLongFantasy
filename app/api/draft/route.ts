import { NextResponse } from "next/server";

import { getLeagueSnapshot } from "@/lib/draft/service";

export async function GET() {
  const snapshot = await getLeagueSnapshot();
  return NextResponse.json(snapshot);
}
