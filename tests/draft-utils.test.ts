import assert from "node:assert/strict";
import test from "node:test";
import { Sport } from "@prisma/client";

import {
  buildSnakeDraftOrder,
  findDuplicateNormalizedNames,
  normalizePlayerName,
  parseOwnerOverride,
  parseSpreadsheetPlayerCell,
} from "@/lib/utils/draft";
import { parseKeeperText } from "@/lib/keepers/import";
import { calculateRosterTotals, validateLeagueTotals } from "@/lib/validation/draft";

test("builds snake order correctly", () => {
  const order = buildSnakeDraftOrder(["A", "B", "C"], 2);
  assert.deepEqual(
    order.map((pick) => pick.ownerId),
    ["A", "B", "C", "C", "B", "A"],
  );
});

test("parses owner override while ignoring keeper tokens", () => {
  assert.equal(parseOwnerOverride("(ME) ⚾️ Player Name"), "ME");
  assert.equal(parseOwnerOverride("(K2) 🏈 Player Name"), null);
  assert.equal(parseOwnerOverride("(K4) Player Name"), null);
});

test("normalizes player names", () => {
  assert.equal(normalizePlayerName("(ME) ⚾️ Player Name"), "player name");
});

test("detects duplicates", () => {
  assert.deepEqual(findDuplicateNormalizedNames(["(ME) ⚾️ Player Name", "player name"]), ["player name"]);
});

test("parses spreadsheet player cells", () => {
  assert.deepEqual(parseSpreadsheetPlayerCell("🏒 Connor McDavid"), {
    rawValue: "🏒 Connor McDavid",
    playerName: "Connor McDavid",
    normalizedName: "connor mcdavid",
    sport: Sport.HOCKEY,
    overrideOwnerCode: null,
  });
});

test("parses pasted keeper text by round", () => {
  const entries = parseKeeperText(`3 Nathan Mackinnon (K4) (CM)
14
Clayton Keller (K1), Tage Thompson (K1) (JR)
69 (CM) Jacob Wilson (K1) (JR)`);

  assert.deepEqual(
    entries.map((entry) => ({
      round: entry.round,
      playerName: entry.playerName,
      keeperTag: entry.keeperTag,
      pickOwnerCode: entry.pickOwnerCode,
    })),
    [
      { round: 3, playerName: "Nathan Mackinnon", keeperTag: "K4", pickOwnerCode: "CM" },
      { round: 14, playerName: "Clayton Keller", keeperTag: "K1", pickOwnerCode: null },
      { round: 14, playerName: "Tage Thompson", keeperTag: "K1", pickOwnerCode: "JR" },
      { round: 69, playerName: "Jacob Wilson", keeperTag: "K1", pickOwnerCode: "CM" },
    ],
  );
});

test("flags unsupported keeper tags in pasted keeper text", () => {
  const [entry] = parseKeeperText("20 Jordan Love (K5)");

  assert.equal(entry.keeperTag, null);
  assert.deepEqual(entry.invalidKeeperTags, ["K5"]);
});

test("treats legacy keeper tag as first-year keeper", () => {
  const [entry] = parseKeeperText("12 Manny Machado (k)");

  assert.equal(entry.keeperTag, "K1");
  assert.deepEqual(entry.invalidKeeperTags, []);
});

test("calculates roster totals and validates league totals", () => {
  const owners = [
    { id: "1", name: "Zolt", code: "MZ", createdAt: new Date(), updatedAt: new Date() },
    { id: "2", name: "Matt", code: "ME", createdAt: new Date(), updatedAt: new Date() },
  ];
  const slots = [
    {
      id: "s1",
      round: 1,
      slotNumber: 1,
      overallPickNumber: 1,
      defaultOwnerId: "1",
      overrideOwnerCode: null,
      currentOwnerId: "1",
      selectedPlayerId: "p1",
      selectedPlayerName: "Connor McDavid",
      selectedSport: Sport.HOCKEY,
      isKeeper: false,
      originalRawValue: null,
      selectedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      currentOwner: owners[0],
    },
    {
      id: "s2",
      round: 1,
      slotNumber: 2,
      overallPickNumber: 2,
      defaultOwnerId: "2",
      overrideOwnerCode: null,
      currentOwnerId: "2",
      selectedPlayerId: "p2",
      selectedPlayerName: "Shohei Ohtani",
      selectedSport: Sport.BASEBALL,
      isKeeper: false,
      originalRawValue: null,
      selectedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      currentOwner: owners[1],
    },
  ];
  const limits = [
    { id: "l1", sport: Sport.HOCKEY, perOwnerLimit: 1, leagueTotal: 999, createdAt: new Date(), updatedAt: new Date() },
    { id: "l2", sport: Sport.BASEBALL, perOwnerLimit: 1, leagueTotal: 999, createdAt: new Date(), updatedAt: new Date() },
    { id: "l3", sport: Sport.FOOTBALL, perOwnerLimit: 1, leagueTotal: 0, createdAt: new Date(), updatedAt: new Date() },
    { id: "l4", sport: Sport.BASKETBALL, perOwnerLimit: 1, leagueTotal: 0, createdAt: new Date(), updatedAt: new Date() },
    { id: "l5", sport: Sport.GOLF, perOwnerLimit: 1, leagueTotal: 0, createdAt: new Date(), updatedAt: new Date() },
  ];

  const totals = calculateRosterTotals({
    owners,
    slots,
    limits,
    expectedTotalPlayersPerOwner: 1,
  });

  assert.equal(totals[0].bySport[Sport.HOCKEY].status, "exact");

  const leagueTotals = validateLeagueTotals(slots, limits, totals, 1);
  assert.equal(
    leagueTotals.bySport.find((entry) => entry.sport === Sport.HOCKEY)?.status,
    "below",
  );
  assert.equal(leagueTotals.bySport.find((entry) => entry.sport === Sport.HOCKEY)?.target, 2);
});
