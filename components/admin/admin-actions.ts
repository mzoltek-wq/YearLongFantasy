"use server";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { revalidatePath } from "next/cache";
import { Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  getGoogleSheetSourceConfig,
  importSheetRows,
  parseImportText,
  pushFullDraftBoardToGoogleSheetWebhook,
  saveGoogleSheetSourceConfig,
  syncLeagueFromKeeperGoogleSheet,
} from "@/lib/import/google-sheets";
import { normalizePlayerName } from "@/lib/utils/draft";

const execFileAsync = promisify(execFile);

function revalidateAdminViews() {
  ["/admin", "/draft", "/dashboard", "/owners"].forEach((path) => revalidatePath(path));
}

export async function updateRosterLimits(formData: FormData) {
  const ownerCount = await prisma.owner.count();
  const sports = Object.values(Sport);

  await Promise.all(
    sports.map((sport) => {
      const rawValue = formData.get(`rosterLimit-${sport}`);
      const perOwnerLimit = Number(rawValue);

      return prisma.rosterLimit.update({
        where: { sport },
        data: { perOwnerLimit, leagueTotal: perOwnerLimit * ownerCount },
      });
    }),
  );

  revalidateAdminViews();
}

export async function updateTradedPick(formData: FormData) {
  const round = Number(formData.get("round"));
  const slotNumber = Number(formData.get("slotNumber"));
  const ownerCode = String(formData.get("ownerCode") ?? "").trim().toUpperCase();
  const ownerCodeRecord = await prisma.ownerCode.findUnique({
    where: { code: ownerCode },
  });

  if (!ownerCodeRecord) {
    throw new Error(`Unknown owner code "${ownerCode}".`);
  }

  await prisma.draftSlot.update({
    where: {
      round_slotNumber: {
        round,
        slotNumber,
      },
    },
    data: {
      overrideOwnerCode: ownerCodeRecord.code,
      currentOwnerId: ownerCodeRecord.ownerId,
    },
  });

  revalidateAdminViews();
}

export async function createKeeper(formData: FormData) {
  const ownerId = String(formData.get("ownerId"));
  const round = Number(formData.get("round"));
  const playerName = String(formData.get("playerName"));
  const sport = formData.get("sport") as Sport;
  const tag = String(formData.get("tag") ?? "").trim() || null;

  const slot = await prisma.draftSlot.findFirstOrThrow({
    where: {
      round,
      currentOwnerId: ownerId,
    },
  });

  const player = await prisma.player.upsert({
    where: { normalizedName: normalizePlayerName(playerName) },
    update: {
      displayName: playerName.trim(),
      sport,
    },
    create: {
      normalizedName: normalizePlayerName(playerName),
      displayName: playerName.trim(),
      sport,
    },
  });

  await prisma.keeper.create({
    data: {
      ownerId,
      playerId: player.id,
      draftSlotId: slot.id,
      playerName: player.displayName,
      sport,
      tag,
      originalValue: `${tag ? `(${tag}) ` : ""}${player.displayName}`,
    },
  });

  await prisma.draftSlot.update({
    where: { id: slot.id },
    data: {
      selectedPlayerId: player.id,
      selectedPlayerName: player.displayName,
      selectedSport: sport,
      isKeeper: true,
      originalRawValue: `${tag ? `(${tag}) ` : ""}${player.displayName}`,
      selectedAt: new Date(),
    },
  });

  revalidateAdminViews();
}

export async function createOwnerCode(formData: FormData) {
  const ownerId = String(formData.get("ownerId"));
  const code = String(formData.get("code")).trim().toUpperCase();
  const label = String(formData.get("label")).trim();

  await prisma.ownerCode.create({
    data: {
      ownerId,
      code,
      label,
    },
  });

  revalidateAdminViews();
}

export async function importSpreadsheetText(formData: FormData) {
  const input = String(formData.get("importText") ?? "");
  const rows = parseImportText(input);
  await importSheetRows(rows);
  revalidateAdminViews();
}

export async function saveKeeperGoogleSheetSource(formData: FormData) {
  const config = parseGoogleSheetConfigFormData(formData);

  await saveGoogleSheetSourceConfig(config);

  revalidateAdminViews();
}

export async function syncKeeperGoogleSheetSource() {
  const config = await getGoogleSheetSourceConfig();

  if (!config?.spreadsheetUrl) {
    throw new Error("Configure a Google Sheet source URL first.");
  }

  await syncLeagueFromKeeperGoogleSheet(config);
  revalidateAdminViews();
}

export async function syncKeeperGoogleSheetSourceFromForm(formData: FormData) {
  const config = parseGoogleSheetConfigFormData(formData);

  await saveGoogleSheetSourceConfig(config);
  await syncLeagueFromKeeperGoogleSheet(config);
  revalidateAdminViews();
}

export async function pushDraftBoardToKeeperGoogleSheet() {
  await pushFullDraftBoardToGoogleSheetWebhook();
}

export async function resetDemoData() {
  await execFileAsync("/Users/michaelzoltek/Library/pnpm/pnpm", ["db:seed"], {
    cwd: process.cwd(),
    env: process.env,
  });
  revalidateAdminViews();
}

function parseGoogleSheetConfigFormData(formData: FormData) {
  const spreadsheetUrl = String(formData.get("spreadsheetUrl") ?? "").trim();
  const writebackWebhookUrl = String(formData.get("writebackWebhookUrl") ?? "").trim();
  const draftViewSheetName = String(formData.get("draftViewSheetName") ?? "").trim();
  const picksSheetName = String(formData.get("picksSheetName") ?? "").trim();

  if (!spreadsheetUrl) {
    throw new Error("Spreadsheet URL is required.");
  }

  return {
    spreadsheetUrl,
    writebackWebhookUrl: writebackWebhookUrl || null,
    draftViewSheetName: draftViewSheetName || "Draft View",
    picksSheetName: picksSheetName || "Picks",
  };
}
