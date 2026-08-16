import { Prisma, Sport } from "@prisma/client";

import { buildPlayerMetadata } from "@/lib/players/resolve";
import { normalizePositions, PositionCode } from "@/lib/roster/positions";
import { normalizePlayerName, parseSportFromValue } from "@/lib/utils/draft";

export type ImportablePlayerRecord = {
  displayName: string;
  sport: Sport;
  espnId?: string | number | null;
  team?: string | null;
  primaryPosition?: string | null;
  eligiblePositions?: string[];
  source: string;
  raw?: Record<string, unknown>;
};

export type PlayerImportResult = {
  imported: number;
  unresolved: number;
  skipped: string[];
};

type PlayerWriter = Pick<Prisma.TransactionClient, "player">;
type PlayerImportOptions = {
  concurrency?: number;
  onProgress?: (progress: { processed: number; total: number; imported: number; unresolved: number }) => void;
};

const SPORT_NAME_TO_ENUM: Record<string, Sport> = {
  HOCKEY: Sport.HOCKEY,
  NHL: Sport.HOCKEY,
  BASEBALL: Sport.BASEBALL,
  MLB: Sport.BASEBALL,
  FOOTBALL: Sport.FOOTBALL,
  NFL: Sport.FOOTBALL,
  BASKETBALL: Sport.BASKETBALL,
  NBA: Sport.BASKETBALL,
  GOLF: Sport.GOLF,
  PGA: Sport.GOLF,
};

export function normalizeSportName(value: string) {
  const parsed = parseSportFromValue(value);
  if (parsed) {
    return parsed;
  }

  return SPORT_NAME_TO_ENUM[value.trim().toUpperCase()] ?? null;
}

export function parsePlayerImportText(text: string, source = "manual-player-import") {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    return [];
  }

  const delimiter = rows.some((row) => row.includes("\t")) ? "\t" : ",";
  const firstParts = splitDelimitedRow(rows[0], delimiter);
  const header = firstParts.map(normalizeHeader);
  const hasHeader = header.some((entry) => ["sport", "playername", "espnplayerid", "primaryposition", "eligibleslots", "positions"].includes(entry));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows.flatMap((row) => {
    const parts = splitDelimitedRow(row, delimiter);
    const record = hasHeader ? recordFromHeader(parts, header, source, row) : recordFromLooseRow(parts, source, row);
    return record ? [record] : [];
  });
}

export async function importPlayerRecords(db: PlayerWriter, records: ImportablePlayerRecord[], options: PlayerImportOptions = {}): Promise<PlayerImportResult> {
  const skipped: string[] = [];
  let imported = 0;
  let unresolved = 0;
  let processed = 0;
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 8, 20));

  async function importRecord(record: ImportablePlayerRecord) {
    const displayName = record.displayName.trim();
    const positions = normalizePositions(record.sport, [record.primaryPosition, ...(record.eligiblePositions ?? [])]);
    const normalizedName = normalizePlayerName(displayName);

    if (!displayName || !record.sport) {
      unresolved += 1;
      skipped.push(record.raw?.row ? String(record.raw.row) : displayName || "Unknown row");
      return;
    }

    const existingPlayer = await db.player.findUnique({
      where: { normalizedName },
      select: { metadata: true },
    });

    await db.player.upsert({
      where: { normalizedName },
      update: {
        displayName,
        sport: record.sport,
        metadata: buildMetadata(record, positions, existingPlayer?.metadata),
      },
      create: {
        normalizedName,
        displayName,
        sport: record.sport,
        metadata: buildMetadata(record, positions),
      },
    });
    imported += 1;
  }

  async function worker() {
    while (cursor < records.length) {
      const record = records[cursor];
      cursor += 1;
      await importRecord(record);
      processed += 1;

      if (processed % 250 === 0 || processed === records.length) {
        options.onProgress?.({ processed, total: records.length, imported, unresolved });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, () => worker()));

  return {
    imported,
    unresolved,
    skipped: skipped.slice(0, 20),
  };
}

function buildMetadata(record: ImportablePlayerRecord, positions: PositionCode[], existingMetadata?: unknown) {
  const current = existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata) ? (existingMetadata as Record<string, unknown>) : {};

  return buildPlayerMetadata({
    positions,
    team: record.team,
    source: record.source,
    existing: {
      manualPositions: current.manualPositions,
      positionOverrideSource: current.positionOverrideSource,
      positionOverrideUpdatedAt: current.positionOverrideUpdatedAt,
      espnId: record.espnId ? String(record.espnId) : null,
      primaryPosition: record.primaryPosition ?? null,
      eligiblePositions: record.eligiblePositions ?? [],
      raw: record.raw ?? {},
    },
  }) as Prisma.InputJsonValue;
}

function recordFromHeader(parts: string[], header: string[], source: string, rawRow: string): ImportablePlayerRecord | null {
  const value = (name: string) => {
    const index = header.indexOf(name);
    return index >= 0 ? parts[index]?.trim() ?? "" : "";
  };
  const sport = normalizeSportName(value("sport"));
  const displayName = value("playername") || value("name") || value("player");

  if (!sport || !displayName) {
    return null;
  }

  return {
    displayName,
    sport,
    espnId: value("espnplayerid") || value("espnid") || value("id") || null,
    primaryPosition: value("primaryposition") || value("position") || null,
    eligiblePositions: splitPositions(value("eligibleslots") || value("eligiblepositions") || value("positions")),
    team: value("team") || null,
    source,
    raw: { row: rawRow },
  };
}

function recordFromLooseRow(parts: string[], source: string, rawRow: string): ImportablePlayerRecord | null {
  const sportIndex = parts.findIndex((part) => normalizeSportName(part));
  const sport = sportIndex >= 0 ? normalizeSportName(parts[sportIndex]) : null;

  if (!sport) {
    return null;
  }

  return {
    displayName: parts.slice(0, sportIndex).join(", ").trim() || parts[0]?.trim() || "",
    sport,
    primaryPosition: parts[sportIndex + 1] ?? null,
    eligiblePositions: splitPositions(parts[sportIndex + 2] ?? ""),
    team: parts[sportIndex + 3] ?? null,
    source,
    raw: { row: rawRow },
  };
}

function splitPositions(value: string) {
  return value
    .split(/[,\s/|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitDelimitedRow(row: string, delimiter: string) {
  if (delimiter === "\t") {
    return row.split("\t").map((part) => part.trim());
  }

  const parts: string[] = [];
  let current = "";
  let isQuoted = false;

  for (const character of row) {
    if (character === '"') {
      isQuoted = !isQuoted;
      continue;
    }

    if (character === "," && !isQuoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current.trim());
  return parts;
}

function normalizeHeader(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
