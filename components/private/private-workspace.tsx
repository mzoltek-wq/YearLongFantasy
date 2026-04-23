import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";

export async function PrivateWorkspace() {
  const [rankings, watchlist, strategies] = await Promise.all([
    prisma.ranking.findMany({
      where: { isPrivate: true },
      include: { player: true },
      orderBy: { rank: "asc" },
      take: 12,
    }),
    prisma.watchlistEntry.findMany({
      include: { owner: true, player: true },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),
    prisma.draftStrategyProfile.findMany({
      orderBy: { createdAt: "asc" },
      take: 3,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Phase 3 scaffold</p>
          <h2 className="mt-2 text-2xl font-semibold">Private player board</h2>
          <div className="mt-4 space-y-3 text-sm">
            {rankings.map((ranking) => (
              <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={ranking.id}>
                #{ranking.rank} {ranking.player.displayName}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Watchlist</p>
          <h2 className="mt-2 text-2xl font-semibold">Private notes and flags</h2>
          <div className="mt-4 space-y-3 text-sm">
            {watchlist.map((entry) => (
              <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={entry.id}>
                <p className="font-semibold">{entry.player.displayName}</p>
                <p className="text-[var(--muted)]">{entry.notes}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Strategy profiles</p>
          <h2 className="mt-2 text-2xl font-semibold">Draft plan foundation</h2>
          <div className="mt-4 space-y-3 text-sm">
            {strategies.map((strategy) => (
              <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={strategy.id}>
                <p className="font-semibold">{strategy.name}</p>
                <pre className="mt-2 overflow-x-auto text-xs text-[var(--muted)]">{JSON.stringify(strategy.settings, null, 2)}</pre>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
