import Link from "next/link";

import { Card } from "@/components/ui/card";
import { getLeagueSnapshot } from "@/lib/draft/service";

export default async function OwnersPage() {
  const snapshot = await getLeagueSnapshot();

  return (
    <Card>
      <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Owners</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.ownerTotals.map((row) => (
          <Link className="rounded-[24px] border border-[var(--border)] p-5 transition hover:border-[var(--accent)]" href={`/owners/${row.owner.id}`} key={row.owner.id}>
            <p className="text-lg font-semibold">{row.owner.name}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {row.totalSelected} selected • {row.picksLeft} picks left
            </p>
          </Link>
        ))}
      </div>
    </Card>
  );
}
