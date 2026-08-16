import { Sport } from "@prisma/client";

export type MagicAssistantBoardType = "redraft" | "dynasty";

export type MagicAssistantPlayer = {
  id: string;
  normalizedName: string;
  displayName: string;
  sport: Sport;
  boardType: MagicAssistantBoardType;
  source: string;
  rank: number | null;
  position: string | null;
  positionGroup: string | null;
  team: string | null;
  tier: number | null;
  injuryStatus: string | null;
  upsideNote: string | null;
};

export type MagicAssistantUnavailablePlayer = {
  displayName: string;
  normalizedName: string;
  sport: Sport | null;
  managerName: string | null;
  round: number | null;
  overallPickNumber: number | null;
  selectionType: "KEEPER" | "DRAFTED";
  source: "draft-slot" | "draft-grid-slot";
};

export type MagicAssistantPlayerRow = MagicAssistantPlayer & {
  isTaken: boolean;
  taken: MagicAssistantUnavailablePlayer | null;
};
