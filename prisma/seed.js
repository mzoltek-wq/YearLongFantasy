const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const envText = fs.readFileSync(envPath, "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();

    if (!key) {
      continue;
    }

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile();

const {
  DraftStatus,
  FeeSource,
  InboundMessageSource,
  InboundMessageStatus,
  PickChangeSource,
  PrismaClient,
  SeasonStatus,
  Sport,
  SportLeagueProvider,
  TradeAssetType,
  TradeSource,
  TradeStatus,
  TransactionFeeType,
  UserRole,
  Weekday,
} = require("@prisma/client");

const prisma = new PrismaClient();

const OWNER_NAMES = ["Zolt", "Martins", "Matt", "Jimbo", "Brad", "Russ", "Sandler", "Mac", "Joe", "Hoff"];

const OWNER_CODES = {
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
};

const SPORTS = [Sport.HOCKEY, Sport.BASEBALL, Sport.FOOTBALL, Sport.BASKETBALL, Sport.GOLF];

const DEFAULT_ROSTER_LIMITS = {
  [Sport.HOCKEY]: 17,
  [Sport.BASEBALL]: 22,
  [Sport.FOOTBALL]: 17,
  [Sport.BASKETBALL]: 14,
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
  await prisma.auditLog.deleteMany();
  await prisma.leagueImportRecord.deleteMany();
  await prisma.leagueImportBatch.deleteMany();
  await prisma.transactionFee.deleteMany();
  await prisma.transactionFeeRule.deleteMany();
  await prisma.standingsBonusAward.deleteMany();
  await prisma.standingSnapshot.deleteMany();
  await prisma.sportLeague.deleteMany();
  await prisma.pickOwnershipChange.deleteMany();
  await prisma.inboundMessage.deleteMany();
  await prisma.tradeAsset.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.draftGridSlot.deleteMany();
  await prisma.draft.deleteMany();
  await prisma.seasonManager.deleteMany();
  await prisma.leagueSeason.deleteMany();
  await prisma.league.deleteMany();
  await prisma.manager.deleteMany();

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
    { round: 4, slotNumber: 5, ownerName: "Sandler", overrideCode: "MS" },
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

  const managers = [];

  for (const [index, managerName] of OWNER_NAMES.entries()) {
    const manager = await prisma.manager.create({
      data: {
        name: managerName,
        displayName: managerName,
        code: OWNER_CODES[managerName],
        isActive: true,
        joinedAt: new Date("2018-01-01T12:00:00.000Z"),
      },
    });

    managers.push(manager);
  }

  const league = await prisma.league.create({
    data: {
      name: "Year Long Fantasy",
    },
  });

  const season = await prisma.leagueSeason.create({
    data: {
      leagueId: league.id,
      year: 2026,
      name: "2026 Year Long Fantasy",
      draftYear: 2026,
      status: SeasonStatus.SETUP,
      roundCount: 73,
      managerCount: managers.length,
      expectedRosterSize: 73,
    },
  });

  for (const [index, manager] of managers.entries()) {
    await prisma.seasonManager.create({
      data: {
        seasonId: season.id,
        managerId: manager.id,
        slotNumber: index + 1,
        teamName: manager.displayName,
        isActive: true,
      },
    });
  }

  const draft = await prisma.draft.create({
    data: {
      seasonId: season.id,
      name: "2026 Main Draft",
      roundCount: 73,
      status: DraftStatus.SETUP,
    },
  });

  const v2SnakeOrder = buildSnakeDraftOrder(
    managers.map((manager) => manager.id),
    73,
  );

  for (const item of v2SnakeOrder) {
    await prisma.draftGridSlot.create({
      data: {
        draftId: draft.id,
        seasonId: season.id,
        round: item.round,
        slotNumber: item.slotNumber,
        overallPickNumber: item.overallPickNumber,
        originalManagerId: item.ownerId,
        currentManagerId: item.ownerId,
      },
    });
  }

  for (const sport of SPORTS) {
    await prisma.sportLeague.create({
      data: {
        seasonId: season.id,
        sport,
        provider: SportLeagueProvider.MANUAL,
        name: `2026 ${sport.toLowerCase()} league`,
        standingsBonusEnabled: sport !== Sport.GOLF,
        standingsBonusCheckDay: sport === Sport.FOOTBALL ? Weekday.TUESDAY : Weekday.MONDAY,
        standingsBonusCheckTime: "07:00",
      },
    });
  }

  await prisma.transactionFeeRule.createMany({
    data: [
      {
        seasonId: season.id,
        transactionType: TransactionFeeType.ADD,
        amount: "1.00",
        isActive: true,
      },
      {
        seasonId: season.id,
        transactionType: TransactionFeeType.TRADE,
        amount: "2.00",
        isActive: true,
      },
    ],
  });

  const zoltManager = managers.find((manager) => manager.name === "Zolt");
  const bradManager = managers.find((manager) => manager.name === "Brad");
  const bradRoundThirteen = await prisma.draftGridSlot.findFirstOrThrow({
    where: {
      draftId: draft.id,
      round: 13,
      originalManagerId: bradManager.id,
    },
  });

  const inboundMessage = await prisma.inboundMessage.create({
    data: {
      seasonId: season.id,
      source: InboundMessageSource.SMS,
      fromName: "Demo group text",
      body: "Zolt trades Ben Rice for Brad's 13th round pick.",
      status: InboundMessageStatus.APPROVED,
      parsedPayload: {
        trade: {
          playerName: "Ben Rice",
          pick: {
            draftYear: 2026,
            round: 13,
            originalManagerCode: bradManager.code,
          },
        },
      },
    },
  });

  const trade = await prisma.trade.create({
    data: {
      seasonId: season.id,
      source: TradeSource.SMS,
      status: TradeStatus.APPLIED,
      rawText: inboundMessage.body,
      notes: "Demo of a text-backed traded pick.",
    },
  });

  await prisma.tradeAsset.create({
    data: {
      tradeId: trade.id,
      fromManagerId: bradManager.id,
      toManagerId: zoltManager.id,
      assetType: TradeAssetType.DRAFT_PICK,
      draftYear: 2026,
      round: 13,
      originalPickManagerId: bradManager.id,
      draftGridSlotId: bradRoundThirteen.id,
      description: "Brad 2026 round 13 pick",
    },
  });

  await prisma.tradeAsset.create({
    data: {
      tradeId: trade.id,
      fromManagerId: zoltManager.id,
      toManagerId: bradManager.id,
      assetType: TradeAssetType.PLAYER,
      playerName: "Ben Rice",
      sport: Sport.BASEBALL,
      description: "Demo waiver player not present on draft grid.",
    },
  });

  await prisma.inboundMessage.update({
    where: { id: inboundMessage.id },
    data: {
      relatedTradeId: trade.id,
    },
  });

  await prisma.draftGridSlot.update({
    where: { id: bradRoundThirteen.id },
    data: {
      currentManagerId: zoltManager.id,
      rawCellValue: `(${zoltManager.code})`,
    },
  });

  await prisma.pickOwnershipChange.create({
    data: {
      seasonId: season.id,
      draftGridSlotId: bradRoundThirteen.id,
      fromManagerId: bradManager.id,
      toManagerId: zoltManager.id,
      source: PickChangeSource.SMS,
      inboundMessageId: inboundMessage.id,
      relatedTradeId: trade.id,
      notes: "Demo pick movement linked to the originating text message.",
      approvedAt: new Date(),
    },
  });

  await prisma.transactionFee.create({
    data: {
      seasonId: season.id,
      managerId: zoltManager.id,
      sport: Sport.BASEBALL,
      transactionType: TransactionFeeType.TRADE,
      amount: "2.00",
      description: "Demo trade fee for Ben Rice pick trade.",
      relatedTradeId: trade.id,
      source: FeeSource.SMS,
      occurredAt: new Date(),
    },
  });
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
