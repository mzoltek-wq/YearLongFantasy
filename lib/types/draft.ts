import { DraftSlot, Keeper, LeagueSettings, Owner, OwnerCode, Player, RosterLimit } from "@prisma/client";

import { OwnerTotals } from "@/lib/validation/draft";

export type DraftSlotWithRelations = DraftSlot & {
  currentOwner: Owner;
  defaultOwner: Owner;
  selectedPlayer: Player | null;
  keeper: Keeper | null;
};

export type KeeperWithRelations = Keeper & {
  owner: Owner;
  player: Player | null;
  draftSlot: DraftSlot | null;
};

export type LeagueSnapshot = {
  owners: Owner[];
  ownerCodes: OwnerCode[];
  slots: DraftSlotWithRelations[];
  keepers: KeeperWithRelations[];
  rosterLimits: RosterLimit[];
  settings: LeagueSettings;
  ownerTotals: OwnerTotals[];
  leagueTotals: ReturnType<typeof import("@/lib/validation/draft").validateLeagueTotals>;
  draftIntegrity: ReturnType<typeof import("@/lib/validation/draft").validateDraftIntegrity>;
  draftWindow: {
    currentPick: DraftSlotWithRelations | null;
    nextPick: DraftSlotWithRelations | null;
    completed: boolean;
  };
};
