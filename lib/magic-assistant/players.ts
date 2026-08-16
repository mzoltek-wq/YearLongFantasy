import rankings from "@/data/magic-assistant-players.json";
import { normalizePlayerName } from "@/lib/utils/draft";

import type { MagicAssistantPlayer, MagicAssistantUnavailablePlayer, MagicAssistantPlayerRow } from "./types";

export function getMagicAssistantPlayers(unavailablePlayers: MagicAssistantUnavailablePlayer[]): MagicAssistantPlayerRow[] {
  const takenByName = new Map<string, MagicAssistantUnavailablePlayer>();

  for (const player of unavailablePlayers) {
    const key = normalizePlayerName(player.normalizedName || player.displayName);
    if (!key) {
      continue;
    }
    takenByName.set(key, player);
  }

  return (rankings as MagicAssistantPlayer[])
    .map((player) => {
      const taken = takenByName.get(normalizePlayerName(player.normalizedName || player.displayName)) ?? null;
      return {
        ...player,
        isTaken: Boolean(taken),
        taken,
      };
    })
    .sort((left, right) => {
      const leftRank = left.rank ?? 999999;
      const rightRank = right.rank ?? 999999;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.displayName.localeCompare(right.displayName);
    });
}
