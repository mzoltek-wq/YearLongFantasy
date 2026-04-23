import { SPORT_LABELS } from "@/lib/constants/league";
import { getOwnerSnapshot } from "@/lib/draft/service";

export async function OwnerRoster({ ownerId }: { ownerId: string }) {
  const snapshot = await getOwnerSnapshot(ownerId);

  if (!snapshot) {
    return <p>Owner not found.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Owner summary</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-sm text-[var(--muted)]">Owner</p>
            <p className="text-2xl font-semibold">{snapshot.owner.name}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--muted)]">Total selected</p>
            <p className="text-2xl font-semibold">{snapshot.totals?.totalSelected ?? 0}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--muted)]">Picks left</p>
            <p className="text-2xl font-semibold">{snapshot.totals?.picksLeft ?? 0}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {Object.entries(snapshot.grouped).map(([sport, slots]) => (
          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6" key={sport}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{SPORT_LABELS[sport as keyof typeof SPORT_LABELS]}</h2>
              <p className="text-sm text-[var(--muted)]">{snapshot.totals?.bySport[sport as keyof typeof snapshot.totals.bySport].count ?? 0} selected</p>
            </div>
            <div className="space-y-3">
              {slots.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No selections yet.</p>
              ) : (
                slots.map((slot) => (
                  <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={slot.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{slot.selectedPlayerName}</p>
                        <p className="text-xs text-[var(--muted)]">
                          Pick {slot.overallPickNumber} • Round {slot.round}
                        </p>
                      </div>
                      {slot.isKeeper ? <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">Keeper</span> : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
