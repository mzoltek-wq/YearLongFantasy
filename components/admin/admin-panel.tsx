import {
  createOwnerCode,
  pushDraftBoardToKeeperGoogleSheet,
  resetDemoData,
  restoreStart2026DraftStateSnapshot,
  saveKeeperGoogleSheetSource,
  saveStart2026DraftStateSnapshot,
  swapDraftPickOwnership,
  syncKeeperGoogleSheetSourceFromForm,
  undoDraftPickOwnershipSwap,
  updateOwnerName,
  updateRosterLimits,
} from "@/components/admin/admin-actions";
import { ConfirmActionButton } from "@/components/admin/confirm-action-button";
import { PickSwapForm, PickSwapOption } from "@/components/admin/pick-swap-form";
import { SyncSheetForm } from "@/components/admin/sync-sheet-form";
import { importV2TradedPicksText } from "@/components/league/league-actions";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { getLeagueSnapshot } from "@/lib/draft/service";
import { getGoogleSheetSourceConfig } from "@/lib/import/google-sheets";
import { getRosterPositionSlots } from "@/lib/roster/positions";
import { formatRosterSlotTemplate } from "@/lib/roster/settings";
import { sportWithEmoji } from "@/lib/utils/format";

const CURRENT_DRAFT_GRID_YEAR = 2026;

function normalizePersonKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export async function AdminPanel({
  feedback,
}: {
  feedback?: {
    status?: string;
    message?: string;
  };
}) {
  const [snapshot, googleSheetConfig, start2026Snapshot, leagueSeasons, recentPickChanges, managers] = await Promise.all([
    getLeagueSnapshot(),
    getGoogleSheetSourceConfig(),
    prisma.importedRecord.findFirst({
      where: {
        recordType: "draft_state_snapshot",
        importKey: "draft-state-snapshot:start-2026",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.leagueSeason.findMany({
      include: {
        drafts: {
          orderBy: { createdAt: "asc" },
          take: 1,
          include: {
            gridSlots: {
              include: {
                currentManager: true,
                originalManager: true,
              },
              orderBy: { overallPickNumber: "asc" },
            },
          },
        },
      },
      orderBy: { year: "asc" },
    }),
    prisma.pickOwnershipChange.findMany({
      include: {
        draftGridSlot: {
          include: {
            originalManager: true,
          },
        },
        fromManager: true,
        season: true,
        toManager: true,
      },
      orderBy: { createdAt: "desc" },
      take: 24,
    }),
    prisma.manager.findMany(),
  ]);
  const currentYear = new Date().getFullYear();
  const openDraftPicks = snapshot.slots.filter((slot) => !slot.selectedPlayerName);
  const managerToOwnerId = new Map(
    managers
      .map((manager) => {
        const managerNameKey = normalizePersonKey(manager.name);
        const managerDisplayKey = normalizePersonKey(manager.displayName ?? "");
        const owner =
          snapshot.owners.find((candidate) => candidate.code.toUpperCase() === manager.code.toUpperCase()) ??
          snapshot.owners.find((candidate) => normalizePersonKey(candidate.name) === managerNameKey || normalizePersonKey(candidate.name) === managerDisplayKey) ??
          snapshot.owners.find((candidate) => normalizePersonKey(candidate.name).startsWith(managerNameKey) || managerNameKey.startsWith(normalizePersonKey(candidate.name))) ??
          snapshot.owners.find((candidate) => {
            return Boolean(managerDisplayKey) && (normalizePersonKey(candidate.name).startsWith(managerDisplayKey) || managerDisplayKey.startsWith(normalizePersonKey(candidate.name)));
          });

        return owner ? [manager.id, owner.id] : null;
      })
      .filter((pair): pair is [string, string] => Boolean(pair)),
  );
  const defaultSwapYear = snapshot.draftWindow.completed ? CURRENT_DRAFT_GRID_YEAR + 1 : CURRENT_DRAFT_GRID_YEAR;
  const pickSwapYears = Array.from(new Set([...leagueSeasons.map((season) => season.year), defaultSwapYear, defaultSwapYear + 1])).sort((left, right) => left - right);
  const livePickSwapOptions: PickSwapOption[] = snapshot.slots.map((slot) => ({
    id: slot.id,
    year: CURRENT_DRAFT_GRID_YEAR,
    ownerId: slot.currentOwnerId,
    round: slot.round,
    overallPickNumber: slot.overallPickNumber,
    originalOwnerName: slot.defaultOwner.name,
    originalOwnerCode: slot.defaultOwner.code,
    selectedPlayerName: slot.selectedPlayerName,
  }));
  const gridPickSwapOptions: PickSwapOption[] = leagueSeasons
    .filter((season) => season.year !== CURRENT_DRAFT_GRID_YEAR)
    .flatMap((season) => {
      const draft = season.drafts[0];

      if (!draft) {
        return [];
      }

      return draft.gridSlots.flatMap((slot) => {
        const ownerId = managerToOwnerId.get(slot.currentManagerId);

        if (!ownerId) {
          return [];
        }

        return [
          {
            id: slot.id,
            year: season.year,
            ownerId,
            round: slot.round,
            overallPickNumber: slot.overallPickNumber,
            originalOwnerName: slot.originalManager.displayName ?? slot.originalManager.name,
            originalOwnerCode: slot.originalManager.code,
            selectedPlayerName: slot.playerName,
          },
        ];
      });
    });
  const pickSwapOptions = [...livePickSwapOptions, ...gridPickSwapOptions];
  const recentPickSwapGroups = recentPickChanges.reduce<
    Array<{
      key: string;
      changes: typeof recentPickChanges;
    }>
  >((groups, change) => {
    const groupKey = `${change.seasonId}:${change.notes ?? "No notes"}:${Math.floor(change.createdAt.getTime() / 5000)}`;
    const existingGroup = groups.find((group) => group.key === groupKey);

    if (existingGroup) {
      existingGroup.changes.push(change);
      return groups;
    }

    return [...groups, { key: groupKey, changes: [change] }];
  }, []);

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
            Swap ownership of two unused round picks after a trade. Enter the round number from the grid, not the overall pick number. This is intentionally 1-for-1 for now and will fail if either pick has already been used.
          </p>

          <PickSwapForm
            action={swapDraftPickOwnership}
            defaultYear={defaultSwapYear}
            openPickCount={openDraftPicks.length}
            options={pickSwapOptions}
            owners={snapshot.owners.map((owner) => ({ id: owner.id, name: owner.name, code: owner.code }))}
            years={pickSwapYears}
          />

          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <h3 className="font-semibold">Recent pick swap history</h3>
            <div className="mt-3 space-y-3">
              {recentPickSwapGroups.length > 0 ? (
                recentPickSwapGroups.slice(0, 6).map((group) => {
                  const canUndo = group.changes.length === 2 && !group.changes.some((change) => change.notes?.startsWith("Undo:"));
                  const firstChange = group.changes[0];

                  return (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3" key={group.key}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-semibold">
                            {firstChange.season.year} swap · {firstChange.createdAt.toLocaleString()}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{firstChange.notes ?? "Manual pick ownership change"}</p>
                        </div>
                        {canUndo ? (
                          <form action={undoDraftPickOwnershipSwap}>
                            <input name="changeIds" type="hidden" value={group.changes.map((change) => change.id).join(",")} />
                            <ConfirmActionButton
                              action={undoDraftPickOwnershipSwap}
                              className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-900"
                              message="Undo this pick swap? This will only work if both picks are still unused and have not been traded again."
                            >
                              Undo
                            </ConfirmActionButton>
                          </form>
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-2">
                        {group.changes.map((change) => (
                          <p className="rounded-xl bg-white px-3 py-2 text-xs text-[var(--muted)]" key={change.id}>
                            Round {change.draftGridSlot.round}, overall {change.draftGridSlot.overallPickNumber}:{" "}
                            <span className="font-semibold text-[var(--foreground)]">
                              {change.fromManager.displayName ?? change.fromManager.name}
                            </span>{" "}
                            to{" "}
                            <span className="font-semibold text-[var(--foreground)]">
                              {change.toManager.displayName ?? change.toManager.name}
                            </span>
                            {" · "}Original pick: {change.draftGridSlot.originalManager.displayName ?? change.draftGridSlot.originalManager.name}
                          </p>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)]">
                  No pick swaps logged yet.
                </p>
              )}
            </div>
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
