const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

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

    if (key) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvFile();

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

const prisma = new PrismaClient();

async function main() {
  const legacyOwner = await prisma.owner.findFirst({
    where: {
      OR: [{ name: "Scared Guys" }, { code: "SG" }, { name: "Sandler" }, { code: "MS" }],
    },
  });

  if (legacyOwner) {
    await prisma.owner.update({
      where: { id: legacyOwner.id },
      data: {
        name: "Sandler",
        code: "MS",
      },
    });

    await prisma.ownerCode.upsert({
      where: { code: "MS" },
      update: {
        label: "Sandler primary code",
        ownerId: legacyOwner.id,
      },
      create: {
        code: "MS",
        label: "Sandler primary code",
        ownerId: legacyOwner.id,
      },
    });

    await prisma.ownerCode.deleteMany({
      where: {
        code: "SG",
        ownerId: legacyOwner.id,
      },
    });
  }

  const manager = await prisma.manager.findFirst({
    where: {
      OR: [{ name: "Scared Guys" }, { code: "SG" }, { name: "Sandler" }, { code: "MS" }],
    },
  });

  if (manager) {
    await prisma.manager.update({
      where: { id: manager.id },
      data: {
        name: "Sandler",
        displayName: "Sandler",
        code: "MS",
      },
    });
  }

  console.log("Sandler/MS backfill complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
