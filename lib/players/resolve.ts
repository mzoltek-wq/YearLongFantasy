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
  matches: DraftPlayerCandidate[];
  sport: Sport | null;
  sportSource: "player-db" | "typed-value" | "unknown";
  positions: PositionCode[];
  positionSource: "player-db" | "typed-value" | "default" | "unknown";
  team: string | null;
  warnings: string[];
  unavailableSelection: DraftPlayerUnavailableSelection | null;
};

export type DraftPlayerCandidate = {
  id: string;
  displayName: string;
  sport: Sport;
  positions: PositionCode[];
  team: string | null;
};

export type DraftPlayerUnavailableSelection = {
  overallPickNumber: number;
  round: number;
  slotNumber: number;
  ownerName: string;
  isKeeper: boolean;
  playerName: string;
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

export async function findDraftPlayerCandidates(
  playerName: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
  limit = 8,
): Promise<DraftPlayerCandidate[]> {
  const cleanedName = cleanDraftPlayerName(playerName);
  const normalizedName = normalizePlayerName(cleanedName || playerName);

  if (normalizedName.length < 2) {
    return [];
  }

  const players = await tx.player.findMany({
    where: {
      normalizedName: {
        contains: normalizedName,
      },
    },
    select: {
      id: true,
      displayName: true,
      sport: true,
      metadata: true,
    },
    orderBy: [{ displayName: "asc" }],
    take: limit,
  });

  return players.map((player) => {
    const metadata = (player.metadata ?? null) as PlayerMetadata | null;

    return {
      id: player.id,
      displayName: player.displayName,
      sport: player.sport,
      positions: extractPositionsFromMetadata(player.sport, metadata),
      team: typeof metadata?.team === "string" ? metadata.team : null,
    };
  });
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
  const matches = existingPlayer ? [] : await findDraftPlayerCandidates(playerName, tx);
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
    matches,
    sport,
    sportSource: existingPlayer?.sport ? "player-db" : typedSport ? "typed-value" : "unknown",
    positions,
    positionSource: metadataPositions.length > 0 ? "player-db" : typedPositions.length > 0 ? "typed-value" : sport === Sport.GOLF ? "default" : "unknown",
    team: typeof metadata?.team === "string" ? metadata.team : null,
    warnings,
    unavailableSelection: null,
  };
}

export async function findExistingDraftSelection({
  playerId,
  normalizedName,
  overallPickNumberToIgnore,
  tx = prisma,
}: {
  playerId?: string | null;
  normalizedName: string;
  overallPickNumberToIgnore?: number;
  tx?: Prisma.TransactionClient | typeof prisma;
}): Promise<DraftPlayerUnavailableSelection | null> {
  const slots = await tx.draftSlot.findMany({
    where: {
      selectedPlayerName: { not: null },
      ...(overallPickNumberToIgnore
        ? {
            overallPickNumber: { not: overallPickNumberToIgnore },
          }
        : {}),
    },
    include: {
      currentOwner: true,
    },
  });
  const existingSlot = slots.find((slot) => {
    if (playerId && slot.selectedPlayerId === playerId) {
      return true;
    }

    return normalizePlayerName(slot.selectedPlayerName ?? "") === normalizedName;
  });

  if (!existingSlot?.selectedPlayerName) {
    return null;
  }

  return {
    overallPickNumber: existingSlot.overallPickNumber,
    round: existingSlot.round,
    slotNumber: existingSlot.slotNumber,
    ownerName: existingSlot.currentOwner.name,
    isKeeper: existingSlot.isKeeper,
    playerName: existingSlot.selectedPlayerName,
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
  const unavailableSelection = await findExistingDraftSelection({
    playerId: resolution.matchedPlayerId,
    normalizedName: normalizePlayerName(resolution.matchedDisplayName ?? resolution.playerName),
    overallPickNumberToIgnore,
  });
  const duplicateWarnings = unavailableSelection
    ? [
        `${unavailableSelection.playerName} is already ${unavailableSelection.isKeeper ? "kept" : "drafted"} by ${unavailableSelection.ownerName} at pick ${unavailableSelection.overallPickNumber}.`,
      ]
    : [];

  if (!resolution.sport) {
    return {
      ...resolution,
      warnings: [...resolution.warnings, ...duplicateWarnings],
      unavailableSelection,
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
    warnings: [...resolution.warnings, ...duplicateWarnings],
    unavailableSelection,
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
