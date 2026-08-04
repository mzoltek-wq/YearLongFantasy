import { Sport } from "@prisma/client";

export const OWNER_NAMES = [
  "Zolt",
  "Martins",
  "Matt",
  "Jimbo",
  "Brad",
  "Russ",
  "Sandler",
  "Mac",
  "Joe",
  "Hoff",
] as const;

export const OWNER_CODES = {
  Zolt: "MZ",
  Martins: "JM",
  Matt: "ME",
  Jimbo: "JB",
  Brad: "BR",
  Russ: "RF",
  Sandler: "MS",
  Mac: "CM",
  Joe: "JR",
  Hoff: "RH",
} as const;

export const SPORTS = [
  Sport.HOCKEY,
  Sport.BASEBALL,
  Sport.FOOTBALL,
  Sport.BASKETBALL,
  Sport.GOLF,
] as const;

export const SPORT_LABELS: Record<Sport, string> = {
  [Sport.HOCKEY]: "Hockey",
  [Sport.BASEBALL]: "Baseball",
  [Sport.FOOTBALL]: "Football",
  [Sport.BASKETBALL]: "Basketball",
  [Sport.GOLF]: "Golf",
};

export const SPORT_EMOJIS: Record<Sport, string> = {
  [Sport.HOCKEY]: "🏒",
  [Sport.BASEBALL]: "⚾️",
  [Sport.FOOTBALL]: "🏈",
  [Sport.BASKETBALL]: "🏀",
  [Sport.GOLF]: "⛳",
};

export const SPORT_ALIASES: Record<string, Sport> = {
  NHL: Sport.HOCKEY,
  HOCKEY: Sport.HOCKEY,
  "🏒": Sport.HOCKEY,
  MLB: Sport.BASEBALL,
  BASEBALL: Sport.BASEBALL,
  "⚾": Sport.BASEBALL,
  "⚾️": Sport.BASEBALL,
  NFL: Sport.FOOTBALL,
  FOOTBALL: Sport.FOOTBALL,
  "🏈": Sport.FOOTBALL,
  NBA: Sport.BASKETBALL,
  BASKETBALL: Sport.BASKETBALL,
  "🏀": Sport.BASKETBALL,
  GOLF: Sport.GOLF,
  PGA: Sport.GOLF,
  "⛳": Sport.GOLF,
};

export const IGNORED_OWNER_OVERRIDE_TOKENS = new Set(["FT", "K", "K1", "K2", "K3", "K4"]);

export const DEFAULT_ROSTER_LIMITS: Record<Sport, number> = {
  [Sport.HOCKEY]: 4,
  [Sport.BASEBALL]: 5,
  [Sport.FOOTBALL]: 4,
  [Sport.BASKETBALL]: 3,
  [Sport.GOLF]: 5,
};

export const DEFAULT_EXPECTED_TOTAL_PLAYERS_PER_OWNER = 15;
export const DEFAULT_TOTAL_ROUNDS = 15;
