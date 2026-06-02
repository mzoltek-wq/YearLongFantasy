import { Sport } from "@prisma/client";

import { OWNER_CODES } from "@/lib/constants/league";
import { parseSportFromValue, stripPlayerDecorators } from "@/lib/utils/draft";

const OWNER_CODE_SET = new Set<string>(Object.values(OWNER_CODES));
const TOKEN_REGEX = /\(([^)]+)\)/g;
const KEEPER_TAG_REGEX = /^K[1-4]$/i;

export type ParsedKeeperTextEntry = {
  round: number;
  rawValue: string;
  playerName: string | null;
  sport: Sport | null;
  keeperTag: string | null;
  pickOwnerCode: string | null;
};

function getTokens(rawValue: string) {
  return [...rawValue.matchAll(TOKEN_REGEX)].map((match) => match[1].trim().toUpperCase());
}

function splitKeeperValues(value: string) {
  return value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseKeeperValue(round: number, rawValue: string): ParsedKeeperTextEntry {
  const tokens = getTokens(rawValue);
  const keeperTag = tokens.find((token) => KEEPER_TAG_REGEX.test(token)) ?? null;
  const pickOwnerCode = tokens.find((token) => OWNER_CODE_SET.has(token)) ?? null;
  const playerName = stripPlayerDecorators(rawValue);

  return {
    round,
    rawValue,
    playerName: playerName || null,
    sport: parseSportFromValue(rawValue),
    keeperTag,
    pickOwnerCode,
  };
}

export function parseKeeperText(input: string): ParsedKeeperTextEntry[] {
  const entries: ParsedKeeperTextEntry[] = [];
  let activeRound: number | null = null;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const roundLine = line.match(/^(\d+)\s*(.*)$/);
    if (roundLine) {
      activeRound = Number(roundLine[1]);
      const value = roundLine[2].trim();

      if (value) {
        entries.push(...splitKeeperValues(value).map((entry) => parseKeeperValue(activeRound as number, entry)));
      }

      continue;
    }

    if (activeRound) {
      entries.push(...splitKeeperValues(line).map((entry) => parseKeeperValue(activeRound as number, entry)));
    }
  }

  return entries;
}
