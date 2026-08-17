import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Sport } from "@prisma/client";

import { OWNER_CODES, OWNER_NAMES } from "@/lib/constants/league";
import { interpretFullKeeperGrid, normalizeFullKeeperGridInput } from "@/lib/keepers/full-grid";
import {
  buildSnakeDraftOrder,
  findDuplicateNormalizedNames,
  normalizePlayerName,
  parseOwnerOverride,
  parseSpreadsheetPlayerCell,
} from "@/lib/utils/draft";
import { parseKeeperText } from "@/lib/keepers/import";
import { parsePlayerImportText } from "@/lib/players/import";
import { evaluateRosterFit, getRosterPositionSlots, normalizePositions } from "@/lib/roster/positions";
import { calculateRosterTotals, validateLeagueTotals } from "@/lib/validation/draft";

const fixturePath = fileURLToPath(new URL("./fixtures/keeper-grid-2026.tsv", import.meta.url));

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

test("treats franchise tag as fourth-year keeper", () => {
  const [entry] = parseKeeperText("3 Connor Hellebuyck (FT)");

  assert.equal(entry.keeperTag, "K4");
  assert.deepEqual(entry.invalidKeeperTags, []);
});

test("interprets full keeper grid ownership from pasted sheet", () => {
  const owners = OWNER_NAMES.map((name) => ({
    id: name,
    name,
    code: OWNER_CODES[name],
  }));
  const ownerByCode = new Map(owners.map((owner) => [owner.code, owner]));
  const input = readFileSync(fixturePath, "utf8");
  const { ownerColumns, interpretations } = interpretFullKeeperGrid(input, owners, ownerByCode);
  const keeperInterpretations = interpretations.filter((entry) => entry.type === "keeper");
  const pickInterpretations = interpretations.filter((entry) => entry.type === "pick");

  assert.equal(ownerColumns.length, 10);
  assert.equal(keeperInterpretations.length, 253);
  assert.equal(pickInterpretations.length, 74);

  const findKeeper = (playerName: string) => {
    const found = keeperInterpretations.find((entry) => entry.entry?.playerName === playerName);
    assert.ok(found, `Expected to find keeper ${playerName}`);
    return found;
  };

  const caleMakar = findKeeper("Cale Makar");
  assert.equal(caleMakar.round, 4);
  assert.equal(caleMakar.originalPickOwner.name, "Matt");
  assert.equal(caleMakar.currentOwner.name, "Zolt");
  assert.equal(caleMakar.entry?.keeperTag, "K3");

  const scottieBarnes = findKeeper("Scottie Barnes");
  assert.equal(scottieBarnes.round, 6);
  assert.equal(scottieBarnes.originalPickOwner.name, "Mac");
  assert.equal(scottieBarnes.currentOwner.name, "Zolt");

  const jonathanTaylor = findKeeper("Jonathan Taylor");
  assert.equal(jonathanTaylor.round, 6);
  assert.equal(jonathanTaylor.originalPickOwner.name, "Jimbo");
  assert.equal(jonathanTaylor.currentOwner.name, "Mac");

  const paulSkenes = findKeeper("Paul Skenes");
  assert.equal(paulSkenes.round, 21);
  assert.equal(paulSkenes.originalPickOwner.name, "Zolt");
  assert.equal(paulSkenes.currentOwner.name, "Joe");
  assert.equal(paulSkenes.entry?.keeperTag, "K3");

  const wyattJohnston = findKeeper("Wyatt Johnston");
  assert.equal(wyattJohnston.round, 73);
  assert.equal(wyattJohnston.originalPickOwner.name, "Sandler");
  assert.equal(wyattJohnston.currentOwner.name, "Joe");
  assert.equal(wyattJohnston.entry?.keeperTag, "K3");

  const zoltRound57Pick = pickInterpretations.find((entry) => entry.round === 57 && entry.originalPickOwner.name === "Zolt");
  assert.equal(zoltRound57Pick?.currentOwner.name, "Hoff");
});

test("preserves leading tab in full grid paste", () => {
  const owners = OWNER_NAMES.map((name) => ({
    id: name,
    name,
    code: OWNER_CODES[name],
  }));
  const ownerByCode = new Map(owners.map((owner) => [owner.code, owner]));
  const input = readFileSync(fixturePath, "utf8");
  const normalizedInput = normalizeFullKeeperGridInput(`\n${input}\n`);

  assert.ok(normalizedInput.startsWith("\tHoff"));

  const { interpretations } = interpretFullKeeperGrid(normalizedInput, owners, ownerByCode);
  const coleCaufield = interpretations.find((entry) => entry.entry?.playerName === "Cole Caulfield");

  assert.equal(coleCaufield?.round, 3);
  assert.equal(coleCaufield?.originalPickOwner.name, "Zolt");
  assert.equal(coleCaufield?.currentOwner.name, "Zolt");
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

test("parses ESPN-style player import rows", () => {
  const [player] = parsePlayerImportText(`Sport,Player Name,ESPN Player ID,Primary Position,Eligible Slots
Hockey,Cale Makar,123,D,D`);

  assert.equal(player.displayName, "Cale Makar");
  assert.equal(player.sport, Sport.HOCKEY);
  assert.equal(player.espnId, "123");
  assert.deepEqual(player.eligiblePositions, ["D"]);
});

test("parses FantasyPros pasted pitcher rankings", () => {
  const players = parsePlayerImportText(`1
Shohei Ohtani (LAD)
DH1\t1\t1\t1.0\t0.0
-
2
Jacob Misiorowski (MIL)
SP1\t1\t3\t2.0\t0.8
-
10
Mason Miller (SD)
RP1\t5\t16\t10.3\t4.5
-
12
Chase Burns (CIN)
SP,RP1\t6\t25\t13.3\t8.3`);

  assert.deepEqual(
    players.map((player) => ({
      displayName: player.displayName,
      sport: player.sport,
      primaryPosition: player.primaryPosition,
      eligiblePositions: player.eligiblePositions,
    })),
    [
      { displayName: "Shohei Ohtani", sport: Sport.BASEBALL, primaryPosition: "DH", eligiblePositions: ["DH", "SP"] },
      { displayName: "Jacob Misiorowski", sport: Sport.BASEBALL, primaryPosition: "SP", eligiblePositions: ["SP"] },
      { displayName: "Mason Miller", sport: Sport.BASEBALL, primaryPosition: "RP", eligiblePositions: ["RP"] },
      { displayName: "Chase Burns", sport: Sport.BASEBALL, primaryPosition: "SP", eligiblePositions: ["SP", "RP"] },
    ],
  );
});

test("baseball roster template matches league lineup settings", () => {
  const slots = getRosterPositionSlots(Sport.BASEBALL);

  assert.deepEqual(slots, [
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
    "UTIL",
    "SP",
    "SP",
    "SP",
    "SP",
    "SP",
    "RP",
    "RP",
    "P",
    "BENCH",
    "BENCH",
    "BENCH",
  ]);
});

test("basketball roster fit can move a PF/C into center when needed", () => {
  const fit = evaluateRosterFit(Sport.BASKETBALL, [
    { id: "wemby", name: "Victor Wembanyama", sport: Sport.BASKETBALL, positions: normalizePositions(Sport.BASKETBALL, ["PF,C"]) },
    { id: "tatum", name: "Jayson Tatum", sport: Sport.BASKETBALL, positions: normalizePositions(Sport.BASKETBALL, ["SF,PF"]) },
    { id: "booker", name: "Devin Booker", sport: Sport.BASKETBALL, positions: normalizePositions(Sport.BASKETBALL, ["SG"]) },
  ]);

  const wembySlot = fit.assignments.find((assignment) => assignment.player?.id === "wemby")?.slot;
  assert.equal(wembySlot, "C");
});

test("hockey normalization preserves defensemen and goalies", () => {
  assert.deepEqual(normalizePositions(Sport.HOCKEY, ["D"]), ["D"]);
  assert.deepEqual(normalizePositions(Sport.HOCKEY, ["G"]), ["G"]);
  assert.deepEqual(normalizePositions(Sport.HOCKEY, ["C,LW,RW"]), ["F"]);
});
