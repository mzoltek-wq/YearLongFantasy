import { DraftSlot, IntegrationType, Prisma, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { buildSnakeDraftOrder, parseSpreadsheetPlayerCell } from "@/lib/utils/draft";

const GOOGLE_SHEET_SOURCE_ID = "keeper-google-sheet-source";
const GOOGLE_SHEET_IMPORT_SOURCE_ID = "google-sheets-import-source";

export type SheetImportRow = {
  round: number;
  slotNumber: number;
  value: string;
};

export type GoogleSheetSourceConfig = {
  spreadsheetUrl: string;
  writebackWebhookUrl?: string | null;
  draftViewSheetName?: string;
  picksSheetName?: string;
};

type KeeperSheetEntry = {
  round: number;
  slotNumber: number;
  defaultOwnerName: string;
  overrideOwnerCode: string | null;
  playerName: string | null;
  sport: Sport | null;
  tag: string | null;
  rawValue: string;
};

export type KeeperValidationIssue = {
  round: number;
  ownerName: string;
  severity: "warning" | "error";
  message: string;
  rawValue: string;
};

function getSheetName(config: GoogleSheetSourceConfig, key: "draftViewSheetName" | "picksSheetName") {
  const defaults = {
    draftViewSheetName: "Draft View",
    picksSheetName: "Picks",
  } as const;

  return config[key] ?? defaults[key];
}

function extractSpreadsheetId(spreadsheetUrl: string) {
  const match = spreadsheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error("Could not parse spreadsheet ID from URL.");
  }

  return match[1];
}

function extractSheetGid(spreadsheetUrl: string) {
  const match = spreadsheetUrl.match(/[?#&]gid=(\d+)/);
  return match?.[1] ?? null;
}

function buildCsvUrl(spreadsheetUrl: string, sheetName?: string) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  const params = new URLSearchParams({ tqx: "out:csv" });

  if (sheetName) {
    params.set("sheet", sheetName);
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?${params.toString()}`;
}

function buildExportCsvUrl(spreadsheetUrl: string, options?: { gid?: string | null; sheetName?: string }) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  const params = new URLSearchParams({ format: "csv" });

  if (options?.gid) {
    params.set("gid", options.gid);
  }

  if (options?.sheetName) {
    params.set("sheet", options.sheetName);
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${params.toString()}`;
}

async function fetchCsvUrl(url: string, errorMessage: string) {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(errorMessage);
  }

  return response.text();
}

async function fetchSheetCsv(spreadsheetUrl: string, sheetName: string) {
  try {
    return await fetchCsvUrl(buildExportCsvUrl(spreadsheetUrl, { sheetName }), `Could not fetch "${sheetName}" from Google Sheets.`);
  } catch {
    return fetchCsvUrl(buildCsvUrl(spreadsheetUrl, sheetName), `Could not fetch "${sheetName}" from Google Sheets.`);
  }
}

async function fetchSheetCsvByGid(spreadsheetUrl: string, gid: string) {
  return fetchCsvUrl(buildExportCsvUrl(spreadsheetUrl, { gid }), `Could not fetch gid "${gid}" from Google Sheets.`);
}

async function fetchDefaultSheetCsv(spreadsheetUrl: string) {
  try {
    return await fetchCsvUrl(buildExportCsvUrl(spreadsheetUrl), "Could not fetch the default sheet from Google Sheets.");
  } catch {
    return fetchCsvUrl(buildCsvUrl(spreadsheetUrl), "Could not fetch the default sheet from Google Sheets.");
  }
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function extractTagTokens(rawValue: string) {
  return [...rawValue.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());
}

function parseKeeperCell(rawValue: string): Omit<KeeperSheetEntry, "round" | "slotNumber" | "defaultOwnerName"> {
  const parsed = parseSpreadsheetPlayerCell(rawValue);
  const tokens = extractTagTokens(rawValue);
  const tag = tokens.find((token) => /^(k|k1|k2|k3|ft)$/i.test(token))?.toUpperCase() ?? null;

  return {
    overrideOwnerCode: parsed.overrideOwnerCode,
    playerName: parsed.playerName.length > 0 ? parsed.playerName : null,
    sport: parsed.sport,
    tag,
    rawValue,
  };
}

function parseDraftViewRows(rows: string[][], knownOwnerNames: Set<string>) {
  const headerRow =
    rows
      .map((row) => ({
        row,
        matches: row.filter((cell) => knownOwnerNames.has(cell.trim())).length,
      }))
      .filter((entry) => entry.matches > 0)
      .sort((left, right) => right.matches - left.matches)[0]?.row ?? null;

  if (!headerRow) {
    throw new Error("Could not find owner header row in Draft View.");
  }

  const ownerColumns = headerRow
    .map((cell, index) => ({ ownerName: cell.trim(), index }))
    .filter((entry) => knownOwnerNames.has(entry.ownerName));

  const ownerOrder = ownerColumns.map((entry) => entry.ownerName);
  const entries: KeeperSheetEntry[] = [];

  for (const row of rows) {
    const round = Number(row[0]);
    if (!Number.isInteger(round) || round <= 0) {
      continue;
    }

    for (const ownerColumn of ownerColumns) {
      const rawValue = row[ownerColumn.index]?.trim();

      if (!rawValue) {
        continue;
      }

      entries.push({
        round,
        slotNumber: entriesForRowSlotNumber(ownerColumns, ownerColumn.index),
        defaultOwnerName: ownerColumn.ownerName,
        ...parseKeeperCell(rawValue),
      });
    }
  }

  return {
    entries,
    ownerOrder,
  };
}

function entriesForRowSlotNumber(ownerColumns: Array<{ ownerName: string; index: number }>, columnIndex: number) {
  return ownerColumns.findIndex((entry) => entry.index === columnIndex) + 1;
}

function hasCompleteOwnerOrder(ownerOrder: string[], owners: Array<{ name: string }>) {
  return ownerOrder.length === owners.length && owners.every((owner) => ownerOrder.includes(owner.name));
}

async function resolveDraftViewSheet(
  spreadsheetUrl: string,
  configuredDraftViewSheetName: string,
  knownOwnerNames: Set<string>,
  owners: Array<{ name: string }>,
) {
  const urlGid = extractSheetGid(spreadsheetUrl);
  const candidates = Array.from(
    new Set([
      urlGid ? `__GID__:${urlGid}` : null,
      configuredDraftViewSheetName,
      "Draft View",
      "Sheet1",
      "__DEFAULT_SHEET__",
    ].filter((candidate): candidate is string => Boolean(candidate))),
  );

  for (const candidate of candidates) {
    try {
      const csv =
        candidate.startsWith("__GID__:") ? await fetchSheetCsvByGid(spreadsheetUrl, candidate.replace("__GID__:", "")) :
        candidate === "__DEFAULT_SHEET__"
          ? await fetchDefaultSheetCsv(spreadsheetUrl)
          : await fetchSheetCsv(spreadsheetUrl, candidate);
      const parsed = parseDraftViewRows(parseCsv(csv), knownOwnerNames);

      if (hasCompleteOwnerOrder(parsed.ownerOrder, owners)) {
        return {
          parsedDraftView: parsed,
          resolvedDraftViewSheetName:
            candidate.startsWith("__GID__:") ? `gid:${candidate.replace("__GID__:", "")}` : candidate === "__DEFAULT_SHEET__" ? "Default sheet" : candidate,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    `Could not determine the full owner order from "${configuredDraftViewSheetName}". ` +
      'Make sure the keeper source tab name is correct and the owner header row contains all 10 owners.',
  );
}

function validateKeeperEntries(entries: KeeperSheetEntry[], knownOwnerCodes: Set<string>) {
  const issues: KeeperValidationIssue[] = [];

  for (const entry of entries) {
    const actualOwnerName = entry.overrideOwnerCode ? `${entry.defaultOwnerName} via ${entry.overrideOwnerCode}` : entry.defaultOwnerName;

    if (entry.overrideOwnerCode && !knownOwnerCodes.has(entry.overrideOwnerCode)) {
      issues.push({
        round: entry.round,
        ownerName: actualOwnerName,
        severity: "error",
        message: `Unknown owner code "${entry.overrideOwnerCode}" in keeper cell.`,
        rawValue: entry.rawValue,
      });
    }

    if (entry.playerName && !entry.sport) {
      issues.push({
        round: entry.round,
        ownerName: actualOwnerName,
        severity: "warning",
        message: "Could not determine sport from keeper cell.",
        rawValue: entry.rawValue,
      });
    }

    if (entry.tag === "FT" && entry.round !== 3) {
      issues.push({
        round: entry.round,
        ownerName: actualOwnerName,
        severity: "warning",
        message: "FT keepers are expected in round 3.",
        rawValue: entry.rawValue,
      });
    }
  }

  return issues;
}

async function upsertPlayer(tx: Prisma.TransactionClient, playerName: string, sport: Sport) {
  const normalizedName = parseSpreadsheetPlayerCell(playerName).normalizedName;
  const existing = await tx.player.findUnique({ where: { normalizedName } });

  if (existing) {
    return existing;
  }

  return tx.player.create({
    data: {
      displayName: playerName,
      normalizedName,
      sport,
    },
  });
}

async function getOrCreateGoogleImportSource(tx: Prisma.TransactionClient) {
  return tx.integrationSource.upsert({
    where: { id: GOOGLE_SHEET_IMPORT_SOURCE_ID },
    update: {
      type: IntegrationType.GOOGLE_SHEETS,
      isActive: true,
      config: { adapter: "GoogleSheetsImportAdapter" },
    },
    create: {
      id: GOOGLE_SHEET_IMPORT_SOURCE_ID,
      type: IntegrationType.GOOGLE_SHEETS,
      isActive: true,
      config: { adapter: "GoogleSheetsImportAdapter" },
    },
  });
}

export async function importSheetRows(rows: SheetImportRow[]) {
  const source = await prisma.integrationSource.upsert({
    where: {
      id: GOOGLE_SHEET_IMPORT_SOURCE_ID,
    },
    update: {
      type: IntegrationType.GOOGLE_SHEETS,
      isActive: true,
      config: { adapter: "GoogleSheetsImportAdapter" },
    },
    create: {
      id: GOOGLE_SHEET_IMPORT_SOURCE_ID,
      type: IntegrationType.GOOGLE_SHEETS,
      isActive: true,
      config: { adapter: "GoogleSheetsImportAdapter" },
    },
  });

  const ownerCodeMap = new Map((await prisma.ownerCode.findMany()).map((code) => [code.code, code.ownerId]));

  for (const row of rows) {
    const parsed = parseSpreadsheetPlayerCell(row.value);
    const slot = await prisma.draftSlot.findUnique({
      where: {
        round_slotNumber: {
          round: row.round,
          slotNumber: row.slotNumber,
        },
      },
    });

    if (!slot) {
      continue;
    }

    const overrideOwnerId = parsed.overrideOwnerCode ? ownerCodeMap.get(parsed.overrideOwnerCode) : null;

    await prisma.importedRecord.create({
      data: {
        integrationSourceId: source.id,
        sourceType: IntegrationType.GOOGLE_SHEETS,
        recordType: "draft_slot",
        rawPayload: row,
        normalizedPayload: parsed,
        importKey: `${row.round}-${row.slotNumber}`,
      },
    });

    await prisma.draftSlot.update({
      where: { id: slot.id },
      data: {
        overrideOwnerCode: parsed.overrideOwnerCode,
        currentOwnerId: overrideOwnerId ?? slot.defaultOwnerId,
        selectedPlayerName: parsed.playerName || null,
        selectedSport: parsed.sport as Sport | null,
        originalRawValue: parsed.rawValue,
      },
    });
  }
}

export async function saveGoogleSheetSourceConfig(input: GoogleSheetSourceConfig) {
  return prisma.integrationSource.upsert({
    where: { id: GOOGLE_SHEET_SOURCE_ID },
    update: {
      type: IntegrationType.GOOGLE_SHEETS,
      isActive: true,
      config: {
        ...input,
        draftViewSheetName: input.draftViewSheetName || "Draft View",
        picksSheetName: input.picksSheetName || "Picks",
      },
    },
    create: {
      id: GOOGLE_SHEET_SOURCE_ID,
      type: IntegrationType.GOOGLE_SHEETS,
      isActive: true,
      config: {
        ...input,
        draftViewSheetName: input.draftViewSheetName || "Draft View",
        picksSheetName: input.picksSheetName || "Picks",
      },
    },
  });
}

export async function getGoogleSheetSourceConfig() {
  const source = await prisma.integrationSource.findUnique({
    where: { id: GOOGLE_SHEET_SOURCE_ID },
  });

  const dbConfig = (source?.config ?? {}) as Record<string, unknown>;
  const spreadsheetUrl = (dbConfig.spreadsheetUrl as string | undefined) ?? process.env.KEEPER_GOOGLE_SHEET_URL ?? "";
  const writebackWebhookUrl =
    (dbConfig.writebackWebhookUrl as string | undefined) ?? process.env.GOOGLE_SHEETS_WRITEBACK_WEBHOOK_URL ?? "";

  return spreadsheetUrl
    ? {
        spreadsheetUrl,
        writebackWebhookUrl,
        draftViewSheetName: (dbConfig.draftViewSheetName as string | undefined) ?? "Draft View",
        picksSheetName: (dbConfig.picksSheetName as string | undefined) ?? "Picks",
      }
    : null;
}

export async function syncLeagueFromKeeperGoogleSheet(config: GoogleSheetSourceConfig) {
  const configuredDraftViewSheetName = getSheetName(config, "draftViewSheetName");
  const [owners, ownerCodes, appRosterLimits] = await Promise.all([
    prisma.owner.findMany(),
    prisma.ownerCode.findMany(),
    prisma.rosterLimit.findMany(),
  ]);

  const knownOwnerNames = new Set(owners.map((owner) => owner.name));
  const ownerByName = new Map(owners.map((owner) => [owner.name, owner]));
  const ownerCodeMap = new Map(ownerCodes.map((code) => [code.code, code.ownerId]));
  const knownOwnerCodes = new Set(ownerCodes.map((code) => code.code));
  const { parsedDraftView, resolvedDraftViewSheetName } = await resolveDraftViewSheet(
    config.spreadsheetUrl,
    configuredDraftViewSheetName,
    knownOwnerNames,
    owners,
  );

  const keeperEntries = parsedDraftView.entries;
  const totalRounds = appRosterLimits.reduce((total, row) => total + row.perOwnerLimit, 0);
  const validationIssues = validateKeeperEntries(keeperEntries, knownOwnerCodes);
  const ownerIdsInSheetOrder = parsedDraftView.ownerOrder.map((ownerName) => {
    const owner = ownerByName.get(ownerName);
    if (!owner) {
      throw new Error(`Unknown owner "${ownerName}" found in Draft View.`);
    }

    return owner.id;
  });

  await prisma.$transaction(async (tx) => {
    const source = await tx.integrationSource.upsert({
      where: { id: GOOGLE_SHEET_SOURCE_ID },
      update: {
        type: IntegrationType.GOOGLE_SHEETS,
        isActive: true,
        config: {
          ...config,
          draftViewSheetName: configuredDraftViewSheetName,
          lastResolvedDraftViewSheetName: resolvedDraftViewSheetName,
          picksSheetName: getSheetName(config, "picksSheetName"),
          lastSyncAt: new Date().toISOString(),
          lastValidationIssues: validationIssues,
        },
      },
      create: {
        id: GOOGLE_SHEET_SOURCE_ID,
        type: IntegrationType.GOOGLE_SHEETS,
        isActive: true,
        config: {
          ...config,
          draftViewSheetName: configuredDraftViewSheetName,
          lastResolvedDraftViewSheetName: resolvedDraftViewSheetName,
          picksSheetName: getSheetName(config, "picksSheetName"),
          lastSyncAt: new Date().toISOString(),
          lastValidationIssues: validationIssues,
        },
      },
    });

    const importSource = await getOrCreateGoogleImportSource(tx);
    await tx.keeper.deleteMany();
    await tx.draftSlot.deleteMany();

    await tx.leagueSettings.updateMany({
      data: {
        expectedTotalPlayersPerOwner: totalRounds,
        totalRounds,
      },
    });

    const rebuiltDraftSlots = buildSnakeDraftOrder(ownerIdsInSheetOrder, totalRounds);

    await tx.draftSlot.createMany({
      data: rebuiltDraftSlots.map((slot) => ({
        round: slot.round,
        slotNumber: slot.slotNumber,
        overallPickNumber: slot.overallPickNumber,
        defaultOwnerId: slot.ownerId,
        currentOwnerId: slot.ownerId,
      })),
    });

    const slotByRoundAndDefaultOwnerId = new Map(
      (
        await tx.draftSlot.findMany({
          select: {
            id: true,
            round: true,
            defaultOwnerId: true,
          },
        })
      ).map((slot) => [`${slot.round}:${slot.defaultOwnerId}`, slot]),
    );

    for (const entry of keeperEntries) {
      const defaultOwner = ownerByName.get(entry.defaultOwnerName);
      if (!defaultOwner) {
        continue;
      }

      const slot = slotByRoundAndDefaultOwnerId.get(`${entry.round}:${defaultOwner.id}`);

      if (!slot) {
        continue;
      }

      const currentOwnerId = entry.overrideOwnerCode ? ownerCodeMap.get(entry.overrideOwnerCode) ?? defaultOwner.id : defaultOwner.id;

      await tx.importedRecord.create({
        data: {
          integrationSourceId: importSource.id,
          sourceType: IntegrationType.GOOGLE_SHEETS,
          recordType: "keeper_sheet_cell",
          rawPayload: entry.rawValue,
          normalizedPayload: entry,
          importKey: `${entry.round}-${defaultOwner.code}`,
        },
      });

      await tx.draftSlot.update({
        where: { id: slot.id },
        data: {
          currentOwnerId,
          overrideOwnerCode: entry.overrideOwnerCode,
        },
      });

      if (!entry.playerName || !entry.sport) {
        continue;
      }

      const player = await upsertPlayer(tx, entry.playerName, entry.sport);

      await tx.draftSlot.update({
        where: { id: slot.id },
        data: {
          currentOwnerId,
          overrideOwnerCode: entry.overrideOwnerCode,
          selectedPlayerId: player.id,
          selectedPlayerName: player.displayName,
          selectedSport: entry.sport,
          isKeeper: true,
          originalRawValue: entry.rawValue,
          selectedAt: new Date(),
        },
      });

      await tx.keeper.create({
        data: {
          ownerId: currentOwnerId,
          playerId: player.id,
          draftSlotId: slot.id,
          playerName: player.displayName,
          sport: entry.sport,
          tag: entry.tag,
          originalValue: entry.rawValue,
        },
      });
    }

    const nextOpenSlot = await tx.draftSlot.findFirst({
      where: { selectedPlayerName: null },
      orderBy: { overallPickNumber: "asc" },
    });

    await tx.leagueSettings.updateMany({
      data: {
        expectedTotalPlayersPerOwner: totalRounds,
        totalRounds,
        currentDraftPick: nextOpenSlot?.overallPickNumber ?? null,
        currentDraftRound: nextOpenSlot?.round ?? null,
      },
    });
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });

  return {
    importedKeepers: keeperEntries.filter((entry) => entry.playerName).length,
    importedOverrides: keeperEntries.filter((entry) => entry.overrideOwnerCode).length,
    validationIssues,
    totalRounds,
  };
}

function buildPicksWritebackRows(slots: Array<DraftSlot & { currentOwner: { name: string } }>) {
  const header = ["Round", "Overall", "Owner", "Player", "Sport"];
  const rows = slots.map((slot) => [
    slot.round,
    slot.overallPickNumber,
    slot.currentOwner.name,
    slot.selectedPlayerName ?? "",
    slot.selectedSport ?? "",
  ]);

  return [header, ...rows];
}

export async function pushFullDraftBoardToGoogleSheetWebhook() {
  const config = await getGoogleSheetSourceConfig();
  if (!config?.writebackWebhookUrl) {
    return { pushed: false, reason: "No writeback webhook configured." };
  }

  const slots = await prisma.draftSlot.findMany({
    include: { currentOwner: true },
    orderBy: { overallPickNumber: "asc" },
  });

  const response = await fetch(config.writebackWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event: "draft-board-sync",
      spreadsheetUrl: config.spreadsheetUrl,
      sheetName: getSheetName(config, "picksSheetName"),
      rows: buildPicksWritebackRows(slots as Array<DraftSlot & { currentOwner: { name: string } }>),
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to push draft board to Google Sheets webhook.");
  }

  return { pushed: true };
}

export async function pushDraftPickWriteback(overallPickNumber: number, event: "draft-pick-upsert" | "draft-pick-clear") {
  const config = await getGoogleSheetSourceConfig();
  if (!config?.writebackWebhookUrl) {
    return;
  }

  const slot = await prisma.draftSlot.findUnique({
    where: { overallPickNumber },
    include: { currentOwner: true },
  });

  if (!slot) {
    return;
  }

  await fetch(config.writebackWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event,
      spreadsheetUrl: config.spreadsheetUrl,
      sheetName: getSheetName(config, "picksSheetName"),
      pick: {
        round: slot.round,
        overall: slot.overallPickNumber,
        owner: slot.currentOwner.name,
        player: slot.selectedPlayerName,
        sport: slot.selectedSport,
      },
    }),
  }).catch(() => null);
}

export function parseImportText(input: string) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [round, slotNumber, ...valueParts] = line.split(",");
    return {
      round: Number(round),
      slotNumber: Number(slotNumber),
      value: valueParts.join(",").trim(),
    };
  });
}
