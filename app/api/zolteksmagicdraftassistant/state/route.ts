import { NextResponse } from "next/server";

import { getMagicAssistantPlayers } from "@/lib/magic-assistant/players";
import { getMagicAssistantUnavailablePlayers } from "@/lib/magic-assistant/unavailable";

export const dynamic = "force-dynamic";

export async function GET() {
  const unavailablePlayers = await getMagicAssistantUnavailablePlayers();
  const players = getMagicAssistantPlayers(unavailablePlayers);

  return NextResponse.json({
    players,
    unavailablePlayers,
    generatedAt: new Date().toISOString(),
  });
}
