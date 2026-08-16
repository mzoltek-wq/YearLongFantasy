import { Sport } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { makeDraftPick, undoDraftPick, updateDraftPick } from "@/lib/draft/service";

const pickSchema = z.object({
  overallPickNumber: z.number().int().positive(),
  playerName: z.string().trim().min(1),
  sport: z.nativeEnum(Sport).optional(),
});

const undoSchema = z.object({
  overallPickNumber: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const payload = pickSchema.parse(await request.json());
    await makeDraftPick(payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save pick." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = pickSchema.parse(await request.json());
    await updateDraftPick(payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update pick." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = undoSchema.parse(await request.json());
    await undoDraftPick(payload.overallPickNumber);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not clear pick." }, { status: 400 });
  }
}
