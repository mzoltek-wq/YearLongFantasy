import { Sport } from "@prisma/client";

import { SPORT_EMOJIS, SPORT_LABELS } from "@/lib/constants/league";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatSport(sport: Sport) {
  return SPORT_LABELS[sport];
}

export function sportWithEmoji(sport: Sport) {
  return `${SPORT_EMOJIS[sport]} ${SPORT_LABELS[sport]}`;
}
