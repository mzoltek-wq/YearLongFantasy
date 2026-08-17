import { IntegrationType, Sport } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { ROSTER_POSITION_SLOTS, RosterSlotCode } from "@/lib/roster/positions";

export type RosterSlotTemplateMap = Partial<Record<Sport, RosterSlotCode[]>>;

const ROSTER_SLOT_SETTINGS_SOURCE_ID = "roster-slot-settings";

const VALID_SLOT_BY_SPORT: Record<Sport, Set<RosterSlotCode>> = {
  [Sport.BASEBALL]: new Set(["C", "1B", "2B", "3B", "SS", "IF", "OF", "UTIL", "SP", "RP", "P", "BENCH"]),
  [Sport.BASKETBALL]: new Set(["C", "G", "F", "FLEX", "BENCH"]),
  [Sport.FOOTBALL]: new Set(["QB", "RB", "WR", "TE", "FLEX", "OP", "DST", "K", "BENCH"]),
  [Sport.GOLF]: new Set(["GOLFER", "BENCH"]),
  [Sport.HOCKEY]: new Set(["F", "D", "UTIL", "G", "BENCH"]),
};

export function getDefaultRosterSlotTemplates(): Record<Sport, RosterSlotCode[]> {
  return {
    [Sport.HOCKEY]: [...ROSTER_POSITION_SLOTS[Sport.HOCKEY]],
    [Sport.BASEBALL]: [...ROSTER_POSITION_SLOTS[Sport.BASEBALL]],
    [Sport.FOOTBALL]: [...ROSTER_POSITION_SLOTS[Sport.FOOTBALL]],
    [Sport.BASKETBALL]: [...ROSTER_POSITION_SLOTS[Sport.BASKETBALL]],
    [Sport.GOLF]: [...ROSTER_POSITION_SLOTS[Sport.GOLF]],
  };
}

export async function getRosterSlotSettings(): Promise<RosterSlotTemplateMap> {
  const source = await prisma.integrationSource.findUnique({
    where: { id: ROSTER_SLOT_SETTINGS_SOURCE_ID },
  });

  if (!source?.config || typeof source.config !== "object" || Array.isArray(source.config)) {
    return {};
  }

  const config = source.config as Record<string, unknown>;
  const templates = typeof config.templates === "object" && config.templates && !Array.isArray(config.templates) ? (config.templates as Record<string, unknown>) : {};

  return Object.values(Sport).reduce<RosterSlotTemplateMap>((accumulator, sport) => {
    const rawSlots = templates[sport];
    if (!Array.isArray(rawSlots)) {
      return accumulator;
    }

    const slots = rawSlots.map(String).map((slot) => normalizeRosterSlotLabel(sport, slot)).filter((slot): slot is RosterSlotCode => Boolean(slot));
    if (slots.length > 0) {
      accumulator[sport] = slots;
    }

    return accumulator;
  }, {});
}

export async function saveRosterSlotSettings(templates: RosterSlotTemplateMap) {
  await prisma.integrationSource.upsert({
    where: { id: ROSTER_SLOT_SETTINGS_SOURCE_ID },
    update: {
      type: IntegrationType.MANUAL_ENTRY,
      isActive: true,
      config: { adapter: "RosterSlotSettings", templates },
    },
    create: {
      id: ROSTER_SLOT_SETTINGS_SOURCE_ID,
      type: IntegrationType.MANUAL_ENTRY,
      isActive: true,
      config: { adapter: "RosterSlotSettings", templates },
    },
  });
}

export function formatRosterSlotTemplate(slots: RosterSlotCode[]) {
  return slots.join(", ");
}

export function parseRosterSlotTemplate(sport: Sport, rawValue: string, rosterSize: number) {
  const expandedSlots = rawValue
    .split(/[\n,]+/)
    .flatMap((part) => expandRosterSlotPart(sport, part))
    .filter((slot): slot is RosterSlotCode => Boolean(slot));

  if (expandedSlots.length === 0) {
    throw new Error(`Roster spots are required for ${sport.toLowerCase()}.`);
  }

  if (expandedSlots.length > rosterSize) {
    throw new Error(`${sport.toLowerCase()} has ${expandedSlots.length} roster spots but roster size is ${rosterSize}. Increase roster size or remove spots.`);
  }

  return expandedSlots;
}

function expandRosterSlotPart(sport: Sport, rawPart: string) {
  const part = rawPart.trim().toUpperCase();
  if (!part) {
    return [];
  }

  const countMatch = part.match(/^(\d+)\s*x?\s+(.+)$/);
  if (countMatch) {
    const count = Number(countMatch[1]);
    const slot = normalizeRosterSlotLabel(sport, countMatch[2]);
    if (!slot) {
      throw new Error(`"${countMatch[2]}" is not a valid ${sport.toLowerCase()} roster spot.`);
    }

    return Array.from({ length: count }, () => slot);
  }

  return part
    .split(/\s+/)
    .filter(Boolean)
    .map((slot) => {
      const normalized = normalizeRosterSlotLabel(sport, slot);
      if (!normalized) {
        throw new Error(`"${slot}" is not a valid ${sport.toLowerCase()} roster spot.`);
      }

      return normalized;
    });
}

function normalizeRosterSlotLabel(sport: Sport, rawValue: string): RosterSlotCode | null {
  const value = rawValue.trim().toUpperCase().replace("D/ST", "DST");
  const normalized = value === "DEF" ? "DST" : value;
  const validSlots = VALID_SLOT_BY_SPORT[sport];

  return validSlots.has(normalized as RosterSlotCode) ? (normalized as RosterSlotCode) : null;
}
