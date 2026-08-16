"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { fetchEspnPlayerRecords } from "@/lib/players/espn";
import { importPlayerRecords, parsePlayerImportText } from "@/lib/players/import";

function playersFeedbackPath(status: "success" | "error", message: string) {
  return `/players?status=${status}&message=${encodeURIComponent(message)}`;
}

function revalidatePlayersViews() {
  ["/players", "/draft", "/keepers", "/rosters"].forEach((path) => revalidatePath(path));
}

export async function importPlayersText(formData: FormData) {
  let redirectPath = playersFeedbackPath("success", "Player import complete.");

  try {
    const input = String(formData.get("playerImportText") ?? "");
    const records = parsePlayerImportText(input, "manual-player-import");

    if (records.length === 0) {
      throw new Error("No player rows could be parsed.");
    }

    const result = await importPlayerRecords(prisma, records);

    revalidatePlayersViews();
    redirectPath = playersFeedbackPath(
      result.unresolved > 0 ? "error" : "success",
      `Imported ${result.imported} players. ${result.unresolved} row${result.unresolved === 1 ? "" : "s"} could not be read.`,
    );
  } catch (error) {
    redirectPath = playersFeedbackPath("error", error instanceof Error ? error.message : "Could not import players.");
  }

  redirect(redirectPath);
}

export async function importEspnPlayers(formData: FormData) {
  let redirectPath = playersFeedbackPath("success", "ESPN player import complete.");

  try {
    const season = Number(formData.get("season") ?? new Date().getFullYear());
    const limit = Number(formData.get("limit") ?? 2500);
    const { records, failures } = await fetchEspnPlayerRecords({ season, limit });

    if (records.length === 0) {
      throw new Error(`ESPN returned zero players. ${failures.map((failure) => `${failure.sport}: ${failure.message}`).join("; ")}`);
    }

    const result = await importPlayerRecords(prisma, records);
    const failureMessage = failures.length > 0 ? ` ${failures.length} sport request${failures.length === 1 ? "" : "s"} failed.` : "";

    revalidatePlayersViews();
    redirectPath = playersFeedbackPath("success", `Imported ${result.imported} ESPN players for ${season}.${failureMessage}`);
  } catch (error) {
    redirectPath = playersFeedbackPath("error", error instanceof Error ? error.message : "Could not import ESPN players.");
  }

  redirect(redirectPath);
}
