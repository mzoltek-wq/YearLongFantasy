const { PrismaClient, Sport, UserRole } = require("@prisma/client");

const prisma = new PrismaClient();

const OWNER_NAMES = ["Zolt", "Martins", "Matt", "Jimbo", "Brad", "Russ", "Scared Guys", "Mac", "Joe", "Hoff"];

const OWNER_CODES = {
  Zolt: "MZ",
  Martins: "JM",
  Matt: "ME",
  Jimbo: "JB",
  Brad: "BR",
  Russ: "RF",
  "Scared Guys": "SG",
  Mac: "CM",
  Joe: "JR",
  Hoff: "RH",
};

const SPORTS = [Sport.HOCKEY, Sport.BASEBALL, Sport.FOOTBALL, Sport.BASKETBALL, Sport.GOLF];

const DEFAULT_ROSTER_LIMITS = {
  [Sport.HOCKEY]: 4,
  [Sport.BASEBALL]: 5,
  [Sport.FOOTBALL]: 4,
  [Sport.BASKETBALL]: 3,
  [Sport.GOLF]: 5,
};

function normalizePlayerName(input) {
  return input
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\(([^)]+)\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildSnakeDraftOrder(ownerIds, rounds) {
  const order = [];
  let overallPickNumber = 1;

  for (let round = 1; round <= rounds; round += 1) {
    const roundOwners = round % 2 === 1 ? ownerIds : [...ownerIds].reverse();
    roundOwners.forEach((ownerId, index) => {
      order.push({
        round,
        slotNumber: index + 1,
        ownerId,
        overallPickNumber,
      });
      overallPickNumber += 1;
    });
  }

  return order;
}

async function main() {
  await prisma.importedRecord.deleteMany();
  await prisma.integrationSource.deleteMany();
  await prisma.playerNote.deleteMany();
  await prisma.watchlistEntry.deleteMany();
  await prisma.ranking.deleteMany();
  await prisma.draftStrategyProfile.deleteMany();
  await prisma.keeper.deleteMany();
  await prisma.draftSlot.deleteMany();
  await prisma.ownerCode.deleteMany();
  await prisma.owner.deleteMany();
  await prisma.rosterLimit.deleteMany();
  await prisma.leagueSettings.deleteMany();
  await prisma.player.deleteMany();
  await prisma.user.deleteMany();

  const owners = [];

  for (const ownerName of OWNER_NAMES) {
    const owner = await prisma.owner.create({
      data: {
        name: ownerName,
        code: OWNER_CODES[ownerName],
      },
    });

    owners.push(owner);

    await prisma.ownerCode.create({
      data: {
        ownerId: owner.id,
        code: OWNER_CODES[ownerName],
        label: `${ownerName} primary code`,
      },
    });
  }

  for (const sport of SPORTS) {
    await prisma.rosterLimit.create({
      data: {
        sport,
        perOwnerLimit: DEFAULT_ROSTER_LIMITS[sport],
        leagueTotal: DEFAULT_ROSTER_LIMITS[sport] * OWNER_NAMES.length,
      },
    });
  }

  await prisma.leagueSettings.create({
    data: {
      expectedTotalPlayersPerOwner: 15,
      totalRounds: 15,
      currentDraftRound: 1,
      currentDraftPick: 1,
    },
  });

  await prisma.user.createMany({
    data: [
      { email: "commissioner@example.com", name: "Commissioner", role: UserRole.ADMIN },
      { email: "zolt@example.com", name: "Zolt", role: UserRole.PRIVATE_OWNER_WORKSPACE },
    ],
  });

  const snakeOrder = buildSnakeDraftOrder(
    owners.map((owner) => owner.id),
    15,
  );

  for (const item of snakeOrder) {
    await prisma.draftSlot.create({
      data: {
        round: item.round,
        slotNumber: item.slotNumber,
        overallPickNumber: item.overallPickNumber,
        defaultOwnerId: item.ownerId,
        currentOwnerId: item.ownerId,
      },
    });
  }

  const keeperDefinitions = [
    { round: 1, ownerName: "Zolt", playerName: "Connor McDavid", sport: Sport.HOCKEY, tag: "K1" },
    { round: 1, ownerName: "Matt", playerName: "Shohei Ohtani", sport: Sport.BASEBALL, tag: "K1" },
    { round: 2, ownerName: "Martins", playerName: "Nikola Jokic", sport: Sport.BASKETBALL, tag: "K2" },
    { round: 2, ownerName: "Brad", playerName: "Josh Allen", sport: Sport.FOOTBALL, tag: "K2" },
    { round: 3, ownerName: "Russ", playerName: "Scottie Scheffler", sport: Sport.GOLF, tag: "K3" },
  ];

  for (const keeperDefinition of keeperDefinitions) {
    const owner = owners.find((entry) => entry.name === keeperDefinition.ownerName);
    const slot = await prisma.draftSlot.findFirstOrThrow({
      where: {
        round: keeperDefinition.round,
        currentOwnerId: owner.id,
      },
    });

    const player = await prisma.player.upsert({
      where: { normalizedName: normalizePlayerName(keeperDefinition.playerName) },
      update: {},
      create: {
        displayName: keeperDefinition.playerName,
        normalizedName: normalizePlayerName(keeperDefinition.playerName),
        sport: keeperDefinition.sport,
      },
    });

    await prisma.draftSlot.update({
      where: { id: slot.id },
      data: {
        selectedPlayerId: player.id,
        selectedPlayerName: player.displayName,
        selectedSport: keeperDefinition.sport,
        isKeeper: true,
        selectedAt: new Date(),
        originalRawValue: `(${owner.code}) ${player.displayName}`,
      },
    });

    await prisma.keeper.create({
      data: {
        ownerId: owner.id,
        playerId: player.id,
        draftSlotId: slot.id,
        playerName: player.displayName,
        sport: keeperDefinition.sport,
        tag: keeperDefinition.tag,
        originalValue: `(${keeperDefinition.tag}) ${player.displayName}`,
      },
    });
  }

  const tradedPicks = [
    { round: 1, slotNumber: 2, ownerName: "Jimbo", overrideCode: "JB" },
    { round: 2, slotNumber: 8, ownerName: "Zolt", overrideCode: "MZ" },
    { round: 4, slotNumber: 5, ownerName: "Scared Guys", overrideCode: "SG" },
    { round: 5, slotNumber: 4, ownerName: "Hoff", overrideCode: "RH" },
  ];

  for (const trade of tradedPicks) {
    const owner = owners.find((entry) => entry.name === trade.ownerName);
    await prisma.draftSlot.update({
      where: {
        round_slotNumber: {
          round: trade.round,
          slotNumber: trade.slotNumber,
        },
      },
      data: {
        overrideOwnerCode: trade.overrideCode,
        currentOwnerId: owner.id,
      },
    });
  }

  const samplePlayers = [
    { playerName: "Cale Makar", sport: Sport.HOCKEY },
    { playerName: "Aaron Judge", sport: Sport.BASEBALL },
    { playerName: "Christian McCaffrey", sport: Sport.FOOTBALL },
    { playerName: "Luka Doncic", sport: Sport.BASKETBALL },
    { playerName: "Rory McIlroy", sport: Sport.GOLF },
    { playerName: "Nathan MacKinnon", sport: Sport.HOCKEY },
    { playerName: "Bobby Witt Jr.", sport: Sport.BASEBALL },
    { playerName: "Ja'Marr Chase", sport: Sport.FOOTBALL },
    { playerName: "Giannis Antetokounmpo", sport: Sport.BASKETBALL },
    { playerName: "Xander Schauffele", sport: Sport.GOLF },
  ];

  const openSlots = await prisma.draftSlot.findMany({
    where: {
      selectedPlayerName: null,
    },
    orderBy: {
      overallPickNumber: "asc",
    },
    take: samplePlayers.length,
  });

  for (const [index, sample] of samplePlayers.entries()) {
    const slot = openSlots[index];

    const player = await prisma.player.upsert({
      where: { normalizedName: normalizePlayerName(sample.playerName) },
      update: {},
      create: {
        displayName: sample.playerName,
        normalizedName: normalizePlayerName(sample.playerName),
        sport: sample.sport,
      },
    });

    await prisma.draftSlot.update({
      where: { id: slot.id },
      data: {
        selectedPlayerId: player.id,
        selectedPlayerName: player.displayName,
        selectedSport: sample.sport,
        selectedAt: new Date(),
      },
    });
  }

  const zolt = owners.find((owner) => owner.name === "Zolt");
  const privatePlayers = await prisma.player.findMany({
    take: 6,
    orderBy: { displayName: "asc" },
  });

  for (const [index, player] of privatePlayers.entries()) {
    await prisma.ranking.create({
      data: {
        playerId: player.id,
        source: "Private Board",
        rank: index + 1,
        tier: index < 2 ? 1 : 2,
        projection: 100 - index * 7,
        isPrivate: true,
      },
    });

    await prisma.watchlistEntry.create({
      data: {
        ownerId: zolt.id,
        playerId: player.id,
        isDoNotDraft: player.displayName === "Aaron Judge",
        tierOverride: index < 3 ? 1 : 2,
        notes: player.displayName === "Aaron Judge" ? "Injury risk note for demo." : "Priority target for balanced build.",
      },
    });
  }

  await prisma.draftStrategyProfile.create({
    data: {
      ownerId: zolt.id,
      name: "Balanced multi-sport build",
      settings: {
        sportPriorities: {
          HOCKEY: "prioritize early",
          GOLF: "wait on golf",
          FOOTBALL: "cap before round 8",
        },
      },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
