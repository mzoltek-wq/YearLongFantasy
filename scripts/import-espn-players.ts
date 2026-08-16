import { prisma } from "@/lib/db/prisma";
import { fetchEspnPlayerRecords } from "@/lib/players/espn";
import { importPlayerRecords } from "@/lib/players/import";

async function main() {
  const season = Number(process.argv[2] ?? new Date().getFullYear());
  const limit = Number(process.argv[3] ?? 2500);

  console.log(`Fetching ESPN fantasy players for ${season} with limit ${limit} per sport...`);
  const { records, failures } = await fetchEspnPlayerRecords({ season, limit });
  const countsBySport = records.reduce(
    (accumulator, record) => {
      accumulator[record.sport] = (accumulator[record.sport] ?? 0) + 1;
      return accumulator;
    },
    {} as Record<string, number>,
  );

  console.log(`Fetched ${records.length} player records.`);
  console.log(`Fetched by sport: ${JSON.stringify(countsBySport)}`);

  if (failures.length > 0) {
    console.log("ESPN request failures:");
    failures.forEach((failure) => {
      console.log(`- ${failure.sport}: ${failure.status ? `${failure.status} ` : ""}${failure.message}`);
    });
  }

  if (records.length === 0) {
    throw new Error("No ESPN records fetched; aborting import.");
  }

  const result = await importPlayerRecords(prisma, records, {
    concurrency: 8,
    onProgress: (progress) => {
      console.log(`Imported ${progress.processed}/${progress.total} records...`);
    },
  });
  console.log(`Imported ${result.imported} players. Unresolved: ${result.unresolved}.`);

  const storedCounts = await prisma.player.groupBy({
    by: ["sport"],
    _count: { _all: true },
    orderBy: { sport: "asc" },
  });
  console.log("Stored player counts:");
  storedCounts.forEach((entry) => {
    console.log(`- ${entry.sport}: ${entry._count._all}`);
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
