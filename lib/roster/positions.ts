import { Sport } from "@prisma/client";

export type PositionCode =
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "OF"
  | "DH"
  | "SP"
  | "RP"
  | "PG"
  | "SG"
  | "SF"
  | "PF"
  | "QB"
  | "RB"
  | "WR"
  | "TE"
  | "DST"
  | "K"
  | "F"
  | "D"
  | "G"
  | "GOLFER";

export type RosterSlotCode = PositionCode | "IF" | "UTIL" | "FLEX" | "OP" | "P" | "BENCH";

export type RosterPlayer = {
  id: string;
  name: string;
  sport: Sport;
  positions: PositionCode[];
};

export type RosterSlotAssignment = {
  slot: RosterSlotCode;
  player: RosterPlayer | null;
};

export type RosterFitResult = {
  assignments: RosterSlotAssignment[];
  openRequiredSlots: RosterSlotCode[];
  unassignedPlayers: RosterPlayer[];
  warnings: string[];
};

export const ROSTER_POSITION_SLOTS: Record<Sport, RosterSlotCode[]> = {
  [Sport.BASEBALL]: [
    "C",
    "1B",
    "2B",
    "3B",
    "SS",
    "IF",
    "OF",
    "OF",
    "OF",
    "OF",
    "OF",
    "UTIL",
    "UTIL",
    "UTIL",
    "SP",
    "SP",
    "SP",
    "SP",
    "SP",
    "RP",
    "RP",
    "P",
  ],
  [Sport.BASKETBALL]: ["C", "C", "G", "G", "G", "F", "F", "F", "FLEX", "FLEX", "FLEX", "BENCH", "BENCH", "BENCH"],
  [Sport.FOOTBALL]: ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "OP", "DST", "K", "BENCH", "BENCH", "BENCH", "BENCH", "BENCH"],
  [Sport.GOLF]: ["GOLFER", "GOLFER", "GOLFER", "GOLFER", "GOLFER"],
  [Sport.HOCKEY]: ["F", "F", "F", "F", "F", "F", "D", "D", "D", "UTIL", "UTIL", "UTIL", "G", "G", "BENCH", "BENCH", "BENCH"],
};

export const POSITION_OPTIONS_BY_SPORT: Record<Sport, PositionCode[]> = {
  [Sport.BASEBALL]: ["C", "1B", "2B", "3B", "SS", "OF", "DH", "SP", "RP"],
  [Sport.BASKETBALL]: ["PG", "SG", "SF", "PF", "C"],
  [Sport.FOOTBALL]: ["QB", "RB", "WR", "TE", "DST", "K"],
  [Sport.GOLF]: ["GOLFER"],
  [Sport.HOCKEY]: ["F", "D", "G"],
};

export function getRosterPositionSlots(sport: Sport, rosterLimit?: number | null) {
  const slots = ROSTER_POSITION_SLOTS[sport] ?? [];

  if (!rosterLimit || rosterLimit <= slots.length) {
    return slots;
  }

  return [...slots, ...Array.from({ length: rosterLimit - slots.length }, () => "BENCH" as RosterSlotCode)];
}

const POSITION_ALIASES: Record<string, PositionCode> = {
  B: "1B",
  "1B": "1B",
  "2B": "2B",
  "3B": "3B",
  SS: "SS",
  OF: "OF",
  LF: "OF",
  CF: "OF",
  RF: "OF",
  DH: "DH",
  SP: "SP",
  RP: "RP",
  P: "SP",
  PG: "PG",
  SG: "SG",
  SF: "SF",
  PF: "PF",
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF: "DST",
  DST: "DST",
  D: "D",
  K: "K",
  C: "C",
  LW: "F",
  RW: "F",
  F: "F",
  G: "G",
  GOLF: "GOLFER",
  PGA: "GOLFER",
  LIV: "GOLFER",
};

export function normalizePositions(sport: Sport, rawPositions: Array<string | null | undefined>) {
  const positions = new Set<PositionCode>();

  rawPositions
    .flatMap((rawPosition) => String(rawPosition ?? "").split(/[,\s/|.-]+/))
    .map((position) => position.trim().toUpperCase())
    .filter(Boolean)
    .forEach((position) => {
      const normalized = POSITION_ALIASES[position];
      if (!normalized) {
        return;
      }

      if (sport === Sport.HOCKEY && ["C", "LW", "RW", "F"].includes(position)) {
        positions.add("F");
        return;
      }

      if (sport === Sport.HOCKEY && ["D", "G"].includes(normalized)) {
        positions.add(normalized);
        return;
      }

      if (sport === Sport.BASKETBALL && ["PG", "SG", "SF", "PF", "C"].includes(normalized)) {
        positions.add(normalized);
        return;
      }

      if (sport === Sport.BASEBALL && ["C", "1B", "2B", "3B", "SS", "OF", "DH", "SP", "RP"].includes(normalized)) {
        positions.add(normalized);
        return;
      }

      if (sport === Sport.FOOTBALL && ["QB", "RB", "WR", "TE", "DST", "K"].includes(normalized)) {
        positions.add(normalized);
        return;
      }

      if (sport === Sport.GOLF) {
        positions.add("GOLFER");
      }
    });

  if (sport === Sport.GOLF) {
    positions.add("GOLFER");
  }

  return Array.from(positions);
}

export function extractPositionsFromMetadata(sport: Sport, metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }

  const record = metadata as Record<string, unknown>;
  const raw = typeof record.raw === "object" && record.raw ? (record.raw as Record<string, unknown>) : {};
  const manualCandidates = [record.manualPositions, record.positionOverride];
  const manualPositions = normalizePositions(
    sport,
    manualCandidates.flatMap((candidate) => (Array.isArray(candidate) ? candidate.map(String) : [candidate == null ? "" : String(candidate)])),
  );

  if (manualPositions.length > 0) {
    return manualPositions;
  }

  const candidates = [
    record.position,
    record.positionGroup,
    record.positions,
    record.espnPositions,
    record.eligiblePositions,
    record.playerPositions,
    raw.player_espn_positions,
    raw.player_positions,
    raw.player_position_id,
    raw.position_id,
    raw.primary_position,
    raw.player_eligibility,
    raw.player_yahoo_positions,
  ];

  return normalizePositions(
    sport,
    candidates.flatMap((candidate) => (Array.isArray(candidate) ? candidate.map(String) : [candidate == null ? "" : String(candidate)])),
  );
}

export function canFillRosterSlot(slot: RosterSlotCode, player: RosterPlayer) {
  const positions = new Set(player.positions);

  if (slot === "BENCH") {
    return true;
  }

  if (player.sport === Sport.BASEBALL) {
    if (slot === "IF") return ["1B", "2B", "3B", "SS"].some((position) => positions.has(position as PositionCode));
    if (slot === "UTIL") return ["C", "1B", "2B", "3B", "SS", "OF", "DH"].some((position) => positions.has(position as PositionCode));
    if (slot === "P") return positions.has("SP") || positions.has("RP");
  }

  if (player.sport === Sport.BASKETBALL) {
    if (slot === "G") return positions.has("PG") || positions.has("SG");
    if (slot === "F") return positions.has("SF") || positions.has("PF");
    if (slot === "FLEX") return ["PG", "SG", "SF", "PF", "C"].some((position) => positions.has(position as PositionCode));
  }

  if (player.sport === Sport.HOCKEY) {
    if (slot === "UTIL") return positions.has("F") || positions.has("D");
  }

  if (player.sport === Sport.FOOTBALL) {
    if (slot === "FLEX") return positions.has("RB") || positions.has("WR") || positions.has("TE");
    if (slot === "OP") return positions.has("QB") || positions.has("RB") || positions.has("WR") || positions.has("TE");
  }

  return positions.has(slot as PositionCode);
}

export function evaluateRosterFit(sport: Sport, players: RosterPlayer[], rosterLimit?: number | null): RosterFitResult {
  const slots = getRosterPositionSlots(sport, rosterLimit);
  const sortedSlotIndexes = slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) => slotFlexibilityScore(left.slot) - slotFlexibilityScore(right.slot));

  const playerToSlot = new Map<string, number>();
  const slotToPlayer = new Map<number, RosterPlayer>();

  function tryAssign(player: RosterPlayer, seenSlots: Set<number>): boolean {
    for (const { slot, index } of sortedSlotIndexes) {
      if (seenSlots.has(index) || !canFillRosterSlot(slot, player)) {
        continue;
      }

      seenSlots.add(index);
      const occupyingPlayer = slotToPlayer.get(index);
      if (!occupyingPlayer || tryAssign(occupyingPlayer, seenSlots)) {
        slotToPlayer.set(index, player);
        playerToSlot.set(player.id, index);
        return true;
      }
    }

    return false;
  }

  players.forEach((player) => {
    if (player.positions.length === 0) {
      return;
    }

    tryAssign(player, new Set());
  });

  const assignments = slots.map((slot, index) => ({
    slot,
    player: slotToPlayer.get(index) ?? null,
  }));
  const openRequiredSlots = assignments.filter((assignment) => !assignment.player && assignment.slot !== "BENCH").map((assignment) => assignment.slot);
  const assignedPlayerIds = new Set(Array.from(slotToPlayer.values()).map((player) => player.id));
  const unassignedPlayers = players.filter((player) => !assignedPlayerIds.has(player.id));
  const warnings: string[] = [];

  if (players.some((player) => player.positions.length === 0)) {
    warnings.push("One or more players are missing position eligibility, so roster slot validation needs review.");
  }

  if (openRequiredSlots.length > 0) {
    warnings.push(`Open required roster slots: ${summarizeSlots(openRequiredSlots)}.`);
  }

  if (unassignedPlayers.length > 0 && players.length <= slots.length) {
    warnings.push(`${unassignedPlayers.map((player) => player.name).join(", ")} could not be placed into an eligible roster slot yet.`);
  }

  return {
    assignments,
    openRequiredSlots,
    unassignedPlayers,
    warnings,
  };
}

function slotFlexibilityScore(slot: RosterSlotCode) {
  if (slot === "BENCH") return 100;
  if (["UTIL", "FLEX", "OP", "P", "IF"].includes(slot)) return 50;
  return 1;
}

function summarizeSlots(slots: RosterSlotCode[]) {
  const counts = slots.reduce(
    (accumulator, slot) => {
      accumulator.set(slot, (accumulator.get(slot) ?? 0) + 1);
      return accumulator;
    },
    new Map<RosterSlotCode, number>(),
  );

  return Array.from(counts.entries())
    .map(([slot, count]) => `${count} ${slot}`)
    .join(", ");
}
