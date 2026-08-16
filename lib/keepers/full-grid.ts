import { Owner } from "@prisma/client";

import { ParsedKeeperTextEntry, parseKeeperText } from "@/lib/keepers/import";

export type FullGridOwner = Pick<Owner, "id" | "name" | "code">;

export type FullGridInterpretation = {
  type: "keeper" | "pick";
  round: number;
  rawValue: string;
  originalPickOwner: FullGridOwner;
  currentOwner: FullGridOwner;
  ownerCode: string | null;
  entry: (ParsedKeeperTextEntry & { playerName: string }) | null;
};

export function normalizeFullKeeperGridInput(input: string) {
  return input
    .replace(/^\uFEFF/, "")
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "");
}

export function getOwnerCodeFromRawValue(rawValue: string, ownerByCode: Map<string, FullGridOwner>) {
  for (const match of rawValue.matchAll(/\(([A-Z]{2})\)/gi)) {
    const code = match[1]?.toUpperCase();
    if (code && ownerByCode.has(code)) {
      return code;
    }
  }

  return null;
}

export function normalizeOwnerHeader(value: string) {
  return value
    .replace(/[^a-z0-9]/gi, "")
    .trim()
    .toLowerCase();
}

export function resolveOwnerHeaderOwner(value: string, owners: FullGridOwner[]) {
  const normalizedValue = normalizeOwnerHeader(value);

  if (!normalizedValue) {
    return null;
  }

  return (
    owners.find((owner) => normalizeOwnerHeader(owner.name) === normalizedValue) ??
    owners.find((owner) => normalizedValue.startsWith(normalizeOwnerHeader(owner.name))) ??
    owners.find((owner) => normalizeOwnerHeader(owner.name).startsWith(normalizedValue)) ??
    null
  );
}

export function interpretFullKeeperGrid(input: string, owners: FullGridOwner[], ownerByCode: Map<string, FullGridOwner>) {
  const rows = normalizeFullKeeperGridInput(input).split(/\r?\n/).map((row) => row.split("\t").map((cell) => cell.trim()));
  const headerIndex = rows.findIndex((row) => row.filter((cell) => resolveOwnerHeaderOwner(cell, owners)).length >= 2);

  if (headerIndex === -1) {
    throw new Error("Could not find an owner header row in the pasted keeper grid.");
  }

  const ownerColumns = rows[headerIndex]
    .map((cell, index) => ({ owner: resolveOwnerHeaderOwner(cell, owners), index }))
    .filter((entry): entry is { owner: FullGridOwner; index: number } => Boolean(entry.owner));
  const interpretations: FullGridInterpretation[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const explicitRound = Number(row[0]);
    const round = Number.isInteger(explicitRound) && explicitRound > 0 ? explicitRound : rowIndex - headerIndex;

    for (const ownerColumn of ownerColumns) {
      const rawValue = row[ownerColumn.index] ?? "";
      if (!rawValue) {
        continue;
      }

      const ownerCode = getOwnerCodeFromRawValue(rawValue, ownerByCode);
      const originalPickOwner = ownerColumn.owner;
      const currentOwner = ownerCode ? ownerByCode.get(ownerCode)! : ownerColumn.owner;
      const parsedEntries = parseKeeperText(`${round} ${rawValue}`).filter(
        (entry): entry is ParsedKeeperTextEntry & { playerName: string } => Boolean(entry.playerName),
      );

      if (parsedEntries.length === 0) {
        if (ownerCode) {
          interpretations.push({
            type: "pick",
            round,
            rawValue,
            originalPickOwner,
            currentOwner,
            ownerCode,
            entry: null,
          });
        }
        continue;
      }

      interpretations.push({
        type: "keeper",
        round,
        rawValue,
        originalPickOwner,
        currentOwner,
        ownerCode,
        entry: {
          ...parsedEntries[0],
          pickOwnerCode: ownerCode,
        },
      });
    }
  }

  return {
    rows,
    headerIndex,
    ownerColumns,
    interpretations,
  };
}
