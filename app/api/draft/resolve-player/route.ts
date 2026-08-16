import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { resolveDraftPlayerWithRosterWarnings } from "@/lib/players/resolve";

const resolveSchema = z.object({
  playerName: z.string().trim().min(1),
  overallPickNumber: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const payload = resolveSchema.parse(await request.json());
    const slot = await prisma.draftSlot.findUnique({
      where: { overallPickNumber: payload.overallPickNumber },
      select: { currentOwnerId: true },
    });

    if (!slot) {
      return NextResponse.json({ error: "Draft slot not found." }, { status: 404 });
    }

    const resolution = await resolveDraftPlayerWithRosterWarnings({
      playerName: payload.playerName,
      ownerId: slot.currentOwnerId,
      overallPickNumberToIgnore: payload.overallPickNumber,
    });

    return NextResponse.json(resolution);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not resolve player." }, { status: 400 });
  }
}
