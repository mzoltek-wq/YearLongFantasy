import { Sport } from "@prisma/client";

import { IGNORED_OWNER_OVERRIDE_TOKENS, SPORT_ALIASES } from "@/lib/constants/league";

const EMOJI_REGEX = /[\p{Extended_Pictographic}\uFE0F]/gu;
const PARENTHETICAL_REGEX = /\(([^)]+)\)/g;

export function normalizePlayerName(input: string) {
  return input
    .replace(EMOJI_REGEX, "")
    .replace(PARENTHETICAL_REGEX, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseOwnerOverride(rawValue: string) {
  const tokens = [...rawValue.matchAll(PARENTHETICAL_REGEX)].map((match) => match[1].trim().toUpperCase());
  return tokens.find((token) => !IGNORED_OWNER_OVERRIDE_TOKENS.has(token)) ?? null;
}

export function parseSportFromValue(rawValue: string): Sport | null {
  const upper = rawValue.toUpperCase();

  for (const [token, sport] of Object.entries(SPORT_ALIASES)) {
    if (upper.includes(token)) {
      return sport;
    }
  }

  return null;
}

export function stripPlayerDecorators(rawValue: string) {
  return rawValue
    .replace(EMOJI_REGEX, "")
    .replace(PARENTHETICAL_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSpreadsheetPlayerCell(rawValue: string) {
  const overrideOwnerCode = parseOwnerOverride(rawValue);
  const sport = parseSportFromValue(rawValue);
  const playerName = stripPlayerDecorators(rawValue);

  return {
    rawValue,
    overrideOwnerCode,
    sport,
    playerName,
    normalizedName: normalizePlayerName(playerName),
  };
}

export function buildSnakeDraftOrder(ownerIds: string[], rounds: number) {
  const order: Array<{ round: number; slotNumber: number; ownerId: string; overallPickNumber: number }> = [];
  let overallPickNumber = 1;

  for (let round = 1; round <= rounds; round += 1) {
    const roundOwners = round % 2 === 1 ? ownerIds : [...ownerIds].reverse();

    roundOwners.forEach((ownerId, index) => {
      order.push({
        round,
        slotNumber: index + 1,
        ownerId,
        overallPickNumber,
      });
      overallPickNumber += 1;
    });
  }

  return order;
}

export function findDuplicateNormalizedNames(names: string[]) {
  const counts = new Map<string, number>();

  names.forEach((name) => {
    const normalized = normalizePlayerName(name);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });

  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}
