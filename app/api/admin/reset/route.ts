import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export async function POST() {
  try {
    await execFileAsync("/Users/michaelzoltek/Library/pnpm/pnpm", ["db:seed"], {
      cwd: process.cwd(),
      env: process.env,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reset failed." }, { status: 500 });
  }
}
