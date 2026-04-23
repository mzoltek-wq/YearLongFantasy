import { NextResponse } from "next/server";
import { z } from "zod";

import { importSheetRows } from "@/lib/import/google-sheets";

const schema = z.object({
  rows: z.array(
    z.object({
      round: z.number().int().positive(),
      slotNumber: z.number().int().positive(),
      value: z.string().trim().min(1),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    await importSheetRows(payload.rows);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
  }
}
