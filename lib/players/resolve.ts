import { Prisma, Sport } from "@prisma/client";

import { SPORT_LABELS } from "@/lib/constants/league";
import { prisma } from "@/lib/db/prisma";
import { extractPositionsFromMetadata, normalizePositions, PositionCode, RosterPlayer, evaluateRosterFit } from "@/lib/roster/positions";
import { normalizePlayerName, parseSportFromValue, stripPlayerDecorators } from "@/lib/utils/draft";

const POSITION_TOKEN_REGEX = /\b(C|1B|2B|3B|SS|OF|DH|SP|RP|PG|SG|SF|PF|QB|RB|WR|TE|DST|DEF|K|LW|RW|D|G|F)\b/gi;
const SPORT_WORD_REGEX = /\b(NHL|MLB|NFL|NBA|PGA|GOLF|HOCKEY|BASEBALL|FOOTBALL|BASKETBALL)\b/gi;

type PlayerMetadata = {
  positions?: string[] | string;
  espnPositions?: string[] | string;
  position?: string;
  positionGroup?: string;
  team?: string;
  source?: string;
  raw?: Record<string, unknown>;
};

export type DraftPlayerResolution = {
  playerName: string;
  normalizedName: string;
  matchedPlayerId: string | null;
  matchedDisplayName: string | null;
  sport: Sport | null;
  sportSource: "player-db" | "typed-value" | "unknown";
  positions: PositionCode[];
  positionSource: "player-db" | "typed-value" | "default" | "unknown";
  team: string | null;
  warnings: string[];
};

export function cleanDraftPlayerName(rawValue: string) {
  return stripPlayerDecorators(rawValue)
    .replace(SPORT_WORD_REGEX, " ")
    .replace(POSITION_TOKEN_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTypedPositions(rawValue: string, sport: Sport | null) {
  if (!sport) {
    return [];
  }

  return normalizePositions(
    sport,
    Array.from(rawValue.matchAll(POSITION_TOKEN_REGEX)).map((match) => match[0]),
  );
}

export async function resolveDraftPlayer(playerName: string, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<DraftPlayerResolution> {
  const cleanedName = cleanDraftPlayerName(playerName);
  const normalizedName = normalizePlayerName(cleanedName || playerName);
  const typedSport = parseSportFromValue(playerName);
  const existingPlayer = await tx.player.findUnique({
    where: { normalizedName },
  });
  const sport = existingPlayer?.sport ?? typedSport;
  const metadata = (existingPlayer?.metadata ?? null) as PlayerMetadata | null;
  const metadataPositions = sport ? extractPositionsFromMetadata(sport, metadata) : [];
  const typedPositions = parseTypedPositions(playerName, sport);
  const positions = metadataPositions.length > 0 ? metadataPositions : typedPositions;
  const warnings: string[] = [];

  if (!sport) {
    warnings.push("Could not determine this player's sport. Add the player to the database or type a sport token like MLB, NBA, NHL, NFL, or PGA.");
  }

  if (sport && positions.length === 0) {
    warnings.push(`Could not determine ESPN position eligibility for ${cleanedName || playerName}. The pick can be saved, but roster-position validation needs review.`);
  }

  return {
    playerName: cleanedName || playerName.trim(),
    normalizedName,
    matchedPlayerId: existingPlayer?.id ?? null,
    matchedDisplayName: existingPlayer?.displayName ?? null,
    sport,
    sportSource: existingPlayer?.sport ? "player-db" : typedSport ? "typed-value" : "unknown",
    positions,
    positionSource: metadataPositions.length > 0 ? "player-db" : typedPositions.length > 0 ? "typed-value" : sport === Sport.GOLF ? "default" : "unknown",
    team: typeof metadata?.team === "string" ? metadata.team : null,
    warnings,
  };
}

export async function resolveDraftPlayerWithRosterWarnings({
  playerName,
  ownerId,
  overallPickNumberToIgnore,
}: {
  playerName: string;
  ownerId: string;
  overallPickNumberToIgnore?: number;
}) {
  const resolution = await resolveDraftPlayer(playerName);

  if (!resolution.sport) {
    return {
      ...resolution,
      rosterWarnings: [] as string[],
    };
  }

  const ownerSlots = await prisma.draftSlot.findMany({
    where: {
      currentOwnerId: ownerId,
      selectedPlayerName: { not: null },
      selectedSport: resolution.sport,
      ...(overallPickNumberToIgnore
        ? {
            overallPickNumber: { not: overallPickNumberToIgnore },
          }
        : {}),
    },
    include: { selectedPlayer: true },
    orderBy: { overallPickNumber: "asc" },
  });
  const existingRosterPlayers: RosterPlayer[] = ownerSlots.map((slot) => ({
    id: slot.id,
    name: slot.selectedPlayerName ?? "Unknown player",
    sport: resolution.sport!,
    positions: slot.selectedPlayer ? extractPositionsFromMetadata(resolution.sport!, slot.selectedPlayer.metadata) : [],
  }));
  const candidateRosterPlayer: RosterPlayer = {
    id: `candidate:${resolution.normalizedName}`,
    name: resolution.matchedDisplayName ?? resolution.playerName,
    sport: resolution.sport,
    positions: resolution.positions,
  };
  const fit = evaluateRosterFit(resolution.sport, [...existingRosterPlayers, candidateRosterPlayer]);
  const rosterWarnings = fit.warnings.map((warning) => `${SPORT_LABELS[resolution.sport!]} roster warning: ${warning}`);

  return {
    ...resolution,
    rosterWarnings,
  };
}

export function buildPlayerMetadata({
  positions,
  team,
  source,
  existing,
}: {
  positions: PositionCode[];
  team?: string | null;
  source: string;
  existing?: unknown;
}) {
  const current = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};

  return {
    ...current,
    positions,
    espnPositions: positions,
    team: team ?? current.team ?? null,
    source,
  };
}
