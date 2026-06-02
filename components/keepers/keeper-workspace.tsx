import { Sport } from "@prisma/client";

import { importKeeperText } from "@/components/keepers/keeper-actions";
import { DraftOrderForm } from "@/components/keepers/draft-order-form";
import { Card } from "@/components/ui/card";
import { SPORTS } from "@/lib/constants/league";
import { getLeagueSnapshot } from "@/lib/draft/service";
import { sportWithEmoji } from "@/lib/utils/format";

const SAMPLE_KEEPER_TEXT = `3 Nathan Mackinnon (K4) (CM)
5 Mitch Marner (K1) (CM)
12 Paolo Banchero (K3)
14 Clayton Keller (K1), Tage Thompson (K1) (JR)`;

export async function KeeperWorkspace({
  feedback,
}: {
  feedback?: {
    status?: string;
    message?: string;
  };
}) {
  const snapshot = await getLeagueSnapshot();
  const roundOneSlots = snapshot.slots.filter((slot) => slot.round === 1).sort((left, right) => left.slotNumber - right.slotNumber);
  const orderedOwners =
    roundOneSlots.length === snapshot.owners.length
      ? roundOneSlots.map((slot) => slot.defaultOwner)
      : snapshot.owners.sort((left, right) => left.name.localeCompare(right.name));
  const orderedOwnerIds = orderedOwners.map((owner) => owner.id);
  const maxRound = snapshot.settings.totalRounds;
  const slotsByRoundAndOwner = new Map(snapshot.slots.map((slot) => [`${slot.round}:${slot.defaultOwnerId}`, slot]));

  return (
    <div className="space-y-6">
      {feedback?.message ? (
        <Card className={feedback.status === "error" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}>
          <p className={`text-sm font-medium ${feedback.status === "error" ? "text-rose-900" : "text-emerald-900"}`}>{feedback.message}</p>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Draft order</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              Set the first-round order before importing keepers. The app will snake the remaining rounds from this order using the current roster sizes.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold">
            {maxRound} rounds
          </div>
        </div>
        <DraftOrderForm owners={snapshot.owners} orderedOwnerIds={orderedOwnerIds} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card>
          <h2 className="text-xl font-semibold">Import owner keepers</h2>
          <form action={importKeeperText} className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Keeper owner</span>
                <select className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="ownerId">
                  {orderedOwners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Fallback sport</span>
                <select className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="fallbackSport">
                  <option value="">Require sport marker</option>
                  {SPORTS.map((sport) => (
                    <option key={sport} value={sport}>
                      {sportWithEmoji(sport)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              className="min-h-80 w-full rounded-2xl border border-[var(--border)] px-4 py-3 font-mono text-sm"
              name="keeperText"
              placeholder={SAMPLE_KEEPER_TEXT}
            />
            <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
              Import keepers
            </button>
          </form>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Post-draft exports</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">Download spreadsheet-friendly CSV files after the draft.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/api/export">
                Draft board CSV
              </a>
              <a className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" href="/api/export?view=rosters">
                Rosters CSV
              </a>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {snapshot.ownerTotals.map((ownerTotal) => (
              <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={ownerTotal.owner.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{ownerTotal.owner.name}</p>
                  <p className="text-sm text-[var(--muted)]">{ownerTotal.totalSelected} players</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {SPORTS.map((sport) => (
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1" key={sport}>
                      {sportWithEmoji(sport)} {ownerTotal.bySport[sport as Sport]?.count ?? 0}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Keeper board</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">Rows are rounds. Columns are the original draft slots from the saved draft order.</p>
          </div>
          <p className="text-sm text-[var(--muted)]">{snapshot.keepers.length} keepers loaded</p>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--border)]">
          <div className="min-w-[1100px]">
            <div className="grid bg-[var(--surface-strong)] text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]" style={{ gridTemplateColumns: `72px repeat(${orderedOwners.length}, minmax(120px, 1fr))` }}>
              <div className="border-r border-[var(--border)] px-3 py-3">Round</div>
              {orderedOwners.map((owner) => (
                <div className="border-r border-[var(--border)] px-3 py-3 last:border-r-0" key={owner.id}>
                  {owner.name}
                </div>
              ))}
            </div>
            {Array.from({ length: maxRound }, (_, index) => index + 1).map((round) => (
              <div className="grid border-t border-[var(--border)]" key={round} style={{ gridTemplateColumns: `72px repeat(${orderedOwners.length}, minmax(120px, 1fr))` }}>
                <div className="border-r border-[var(--border)] px-3 py-3 text-sm font-semibold">{round}</div>
                {orderedOwners.map((owner) => {
                  const slot = slotsByRoundAndOwner.get(`${round}:${owner.id}`);
                  const isTraded = Boolean(slot && slot.currentOwnerId !== slot.defaultOwnerId);

                  return (
                    <div className="min-h-20 border-r border-[var(--border)] px-3 py-3 text-sm last:border-r-0" key={owner.id}>
                      {slot ? (
                        <div className="space-y-1">
                          {isTraded ? <p className="text-xs font-semibold text-[var(--accent)]">({slot.currentOwner.code})</p> : null}
                          {slot.selectedPlayerName ? (
                            <>
                              <p className="font-semibold leading-snug">{slot.selectedPlayerName}</p>
                              <p className="text-xs text-[var(--muted)]">
                                {slot.selectedSport ? sportWithEmoji(slot.selectedSport as Sport) : "Sport TBD"}
                                {slot.keeper?.tag ? ` • ${slot.keeper.tag}` : ""}
                              </p>
                            </>
                          ) : (
                            <p className="text-[var(--muted)]">{isTraded ? "Traded pick" : "Open"}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[var(--muted)]">Missing slot</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
