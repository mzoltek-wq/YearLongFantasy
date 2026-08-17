import {
  createOwnerCode,
  pushDraftBoardToKeeperGoogleSheet,
  resetDemoData,
  restoreStart2026DraftStateSnapshot,
  saveKeeperGoogleSheetSource,
  saveStart2026DraftStateSnapshot,
  swapDraftPickOwnership,
  syncKeeperGoogleSheetSourceFromForm,
  updateOwnerName,
  updateRosterLimits,
} from "@/components/admin/admin-actions";
import { ConfirmActionButton } from "@/components/admin/confirm-action-button";
import { SyncSheetForm } from "@/components/admin/sync-sheet-form";
import { importV2TradedPicksText } from "@/components/league/league-actions";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { getLeagueSnapshot } from "@/lib/draft/service";
import { getGoogleSheetSourceConfig } from "@/lib/import/google-sheets";
import { getRosterPositionSlots } from "@/lib/roster/positions";
import { formatRosterSlotTemplate } from "@/lib/roster/settings";
import { sportWithEmoji } from "@/lib/utils/format";

export async function AdminPanel({
  feedback,
}: {
  feedback?: {
    status?: string;
    message?: string;
  };
}) {
  const [snapshot, googleSheetConfig, start2026Snapshot] = await Promise.all([
    getLeagueSnapshot(),
    getGoogleSheetSourceConfig(),
    prisma.importedRecord.findFirst({
      where: {
        recordType: "draft_state_snapshot",
        importKey: "draft-state-snapshot:start-2026",
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const currentYear = new Date().getFullYear();
  const openDraftPicks = snapshot.slots.filter((slot) => !slot.selectedPlayerName);

  return (
    <div className="space-y-6">
      {feedback?.message ? (
        <Card className={feedback.status === "error" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}>
          <p className={`text-sm font-medium ${feedback.status === "error" ? "text-rose-900" : "text-emerald-900"}`}>{feedback.message}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Manage roster settings</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Set roster size and lineup spots for each sport. These values are the backbone of draft validation and the roster-entry page.
          </p>
          <form action={updateRosterLimits} className="mt-4 space-y-4">
            <div className="hidden gap-3 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] md:grid md:grid-cols-[0.7fr_0.45fr_1.85fr]">
              <div>Sport</div>
              <div>Roster size</div>
              <div>Roster spots</div>
            </div>
            {snapshot.rosterLimits.map((limit) => {
              const configuredSlots = snapshot.rosterSlotTemplates[limit.sport];
              const slots = getRosterPositionSlots(limit.sport, limit.perOwnerLimit, configuredSlots);

              return (
              <div className="grid gap-3 rounded-2xl border border-[var(--border)] p-4 md:grid-cols-[0.7fr_0.45fr_1.85fr]" key={limit.id}>
                <div>
                  <p className="text-sm font-semibold">{sportWithEmoji(limit.sport)}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] md:hidden">Roster size</label>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
                    defaultValue={limit.perOwnerLimit}
                    name={`rosterLimit-${limit.sport}`}
                    type="number"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] md:hidden">Roster spots</label>
                  <textarea
                    className="min-h-20 w-full rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-xs"
                    defaultValue={formatRosterSlotTemplate(slots)}
                    name={`rosterSlots-${limit.sport}`}
                  />
                  <p className="text-xs text-[var(--muted)]">
                    Tip: use commas or shorthand like <span className="font-mono">5 SP, 2 RP, 1 P</span>. If spots are fewer than roster size, extra spots become Bench.
                  </p>
                </div>
              </div>
            );
            })}
            <div className="flex justify-end">
              <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
                Save roster settings
              </button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Google Sheet source of truth</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Keep using Google Sheets for keepers and roster setup. Sync the sheet into the app, and optionally point live draft writeback at a webhook when you are ready.
          </p>
          <form action={saveKeeperGoogleSheetSource} className="mt-4 space-y-3" id="google-sheet-config-form">
            <input
              className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
              defaultValue={googleSheetConfig?.spreadsheetUrl ?? ""}
              name="spreadsheetUrl"
              placeholder="Google Sheet URL"
              type="url"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
                defaultValue={googleSheetConfig?.draftViewSheetName ?? "Draft View"}
                name="draftViewSheetName"
                placeholder="Keeper source tab name"
                type="text"
              />
              <input
                className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
                defaultValue={googleSheetConfig?.picksSheetName ?? "Picks"}
                name="picksSheetName"
                placeholder="Draft picks tab name"
                type="text"
              />
            </div>
            <input
              className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
              defaultValue={googleSheetConfig?.writebackWebhookUrl ?? ""}
              name="writebackWebhookUrl"
              placeholder="Optional writeback webhook URL"
              type="url"
            />
            <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" type="submit">
              Save sheet config
            </button>
            <div className="mt-4 flex flex-wrap gap-3">
              <SyncSheetForm action={syncKeeperGoogleSheetSourceFromForm} />
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-3">
            <form action={pushDraftBoardToKeeperGoogleSheet}>
              <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" type="submit">
                Push draft picks to webhook
              </button>
            </form>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)]">
            Set the exact tab names used by your sheet. Keeper sync reads the keeper source tab and will fully reset the in-app draft before rebuilding it from Google Sheets. Draft-pick updates do not write directly to Google Sheets yet; they post to the optional webhook so you can connect Apps Script or another updater once the public app is ready.
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Pre-draft imports</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Temporary preseason workspace for copy/paste imports. Pick ownership import is live; keeper import will plug into the same area once submissions arrive.
          </p>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="font-semibold">Import traded pick ownership</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Paste the mostly blank current-year draft grid from Google Sheets. Blank cells reset to the original pick owner; cells like <span className="font-mono">(MZ)</span> move that pick.
                </p>
              </div>
              <a className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" href={`/league/${currentYear}/grid`}>
                View grid
              </a>
            </div>
            <form action={importV2TradedPicksText} className="mt-4 space-y-3">
              <input name="returnTo" type="hidden" value="admin" />
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Draft year</span>
                <input className="w-full rounded-xl border border-[var(--border)] px-3 py-2" defaultValue={currentYear} name="year" type="number" />
              </label>
              <textarea
                className="min-h-44 w-full rounded-2xl border border-[var(--border)] px-4 py-3 font-mono text-sm"
                name="tradedPicksText"
                placeholder={"Matt\tZolt\tMac\tHoff\n\t\t(JR)\n\t\t(RH)\n13\t\t\t(MZ)"}
              />
              <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
                Import pick ownership grid
              </button>
            </form>
          </div>

          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <h3 className="font-semibold">Import keepers</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Coming next: paste owner keeper submissions with round, player name, keeper status, and optional owner-code override when the keeper uses a traded pick.
            </p>
            <textarea
              className="mt-3 min-h-32 w-full rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 font-mono text-sm text-[var(--muted)]"
              disabled
              placeholder={"Example shape:\n3\tNathan MacKinnon (K4) (CM)\n5\tMitch Marner (K1) (CM)\n12\tPaolo Banchero (K3)"}
            />
            <p className="mt-2 text-xs text-[var(--muted)]">
              Keeper import will validate count, duplicate players, K-status, legal round, sport limits, and whether the owner owns an eligible pick in that round.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Mid-draft pick swap</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Swap ownership of two unused picks after a trade. This is intentionally 1-for-1 for now and will fail if either pick has already been used.
          </p>

          <form action={swapDraftPickOwnership} className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_0.7fr]">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Owner giving pick</span>
                <select className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="leftOwnerId">
                  {snapshot.owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name} ({owner.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Pick #</span>
                <input className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="leftPickNumber" placeholder="20" type="number" />
              </label>
            </div>

            <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              swaps with
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_0.7fr]">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Owner giving pick</span>
                <select className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="rightOwnerId">
                  {snapshot.owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name} ({owner.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Pick #</span>
                <input className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="rightPickNumber" placeholder="53" type="number" />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Optional note</span>
              <input
                className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
                name="notes"
                placeholder="Example: mid-draft trade text or reason"
                type="text"
              />
            </label>

            <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
              Swap unused picks
            </button>
          </form>

          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)]">
            {openDraftPicks.length} picks are currently open. If a pick number is wrong or already belongs to someone else, the swap will be rejected before anything changes.
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Owners and codes</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Keep exactly 10 active draft owners for the current league. Edit names here, and add alternate codes when history or traded-pick imports need them.
          </p>

          <div className="mt-4 space-y-3">
            {snapshot.owners.map((owner) => {
              const ownerCodes = snapshot.ownerCodes.filter((code) => code.ownerId === owner.id);

              return (
                <form action={updateOwnerName} className="rounded-2xl border border-[var(--border)] px-4 py-3" key={owner.id}>
                  <input name="ownerId" type="hidden" value={owner.id} />
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]" htmlFor={`owner-name-${owner.id}`}>
                        Owner name
                      </label>
                      <input
                        className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
                        defaultValue={owner.name}
                        id={`owner-name-${owner.id}`}
                        name="name"
                        type="text"
                      />
                    </div>
                    <div className="flex items-end">
                      <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" type="submit">
                        Save name
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Codes: {ownerCodes.length > 0 ? ownerCodes.map((code) => code.code).join(", ") : owner.code}
                  </p>
                </form>
              );
            })}
          </div>

          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <p className="text-sm font-semibold">Add owner code</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Codes are append-only so older draft sheets, trades, and historical initials keep working.</p>
          </div>

          <form action={createOwnerCode} className="mt-4 grid gap-3 md:grid-cols-3">
            <select className="rounded-xl border border-[var(--border)] px-3 py-2" name="ownerId">
              {snapshot.owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
            <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="code" placeholder="Code" type="text" />
            <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="label" placeholder="Label" type="text" />
            <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white md:col-span-3" type="submit">
              Add owner code
            </button>
          </form>
        </Card>

      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Export and reset</h2>
          <div className="mt-4 space-y-3">
            <a className="inline-flex rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/api/export">
              Download CSV export
            </a>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <h3 className="font-semibold text-amber-950">Testing rollback point</h3>
              <p className="mt-1 text-sm text-amber-900">
                Save the current keeper/draft/grid state before testing. Restore will overwrite current picks, keepers, roster selections, and the draft history grid back to this saved point.
              </p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-900">
                {start2026Snapshot ? `Saved ${start2026Snapshot.createdAt.toLocaleString()}` : "No snapshot saved yet"}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <form action={saveStart2026DraftStateSnapshot}>
                  <ConfirmActionButton
                    action={saveStart2026DraftStateSnapshot}
                    className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950"
                    message="Save the current draft data as the start of 2026 rollback point? This replaces the previous saved rollback point."
                  >
                    Save start of 2026 snapshot
                  </ConfirmActionButton>
                </form>
                <form action={restoreStart2026DraftStateSnapshot}>
                  <ConfirmActionButton
                    action={restoreStart2026DraftStateSnapshot}
                    className="rounded-full bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
                    message="Restore the saved start of 2026 draft state? This will overwrite the current testing data."
                  >
                    Restore start of 2026
                  </ConfirmActionButton>
                </form>
              </div>
            </div>
            <form action={resetDemoData}>
              <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" type="submit">
                Reset and reseed demo data
              </button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
