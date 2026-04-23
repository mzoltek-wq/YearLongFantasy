import { Sport } from "@prisma/client";

import {
  createKeeper,
  createOwnerCode,
  importSpreadsheetText,
  pushDraftBoardToKeeperGoogleSheet,
  resetDemoData,
  saveKeeperGoogleSheetSource,
  syncKeeperGoogleSheetSourceFromForm,
  updateRosterLimits,
  updateTradedPick,
} from "@/components/admin/admin-actions";
import { SyncSheetForm } from "@/components/admin/sync-sheet-form";
import { Card } from "@/components/ui/card";
import { SPORTS } from "@/lib/constants/league";
import { getLeagueSnapshot } from "@/lib/draft/service";
import { getGoogleSheetSourceConfig } from "@/lib/import/google-sheets";
import { sportWithEmoji } from "@/lib/utils/format";

export async function AdminPanel() {
  const [snapshot, googleSheetConfig] = await Promise.all([getLeagueSnapshot(), getGoogleSheetSourceConfig()]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Manage roster limits</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Set the roster size for each sport. These values are the backbone of the draft and help prevent mistakes like someone accidentally taking a 16th baseball player.
          </p>
          <form action={updateRosterLimits} className="mt-4 space-y-4">
            <div className="hidden gap-3 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] md:grid md:grid-cols-[1fr_1fr_auto]">
              <div>Sport</div>
              <div>Roster size</div>
              <div />
            </div>
            {snapshot.rosterLimits.map((limit) => (
              <div className="grid gap-3 rounded-2xl border border-[var(--border)] p-4 md:grid-cols-[1fr_1fr_auto]" key={limit.id}>
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
                <div />
              </div>
            ))}
            <div className="flex justify-end">
              <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
                Save roster sizes
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
          <h2 className="text-xl font-semibold">Manage traded picks</h2>
          <form action={updateTradedPick} className="mt-4 grid gap-3 md:grid-cols-4">
            <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="round" placeholder="Round" type="number" />
            <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="slotNumber" placeholder="Slot" type="number" />
            <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="ownerCode" placeholder="Owner code" type="text" />
            <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" type="submit">
              Apply override
            </button>
          </form>

          <div className="mt-4 space-y-2 text-sm">
            {snapshot.slots
              .filter((slot) => slot.overrideOwnerCode)
              .slice(0, 10)
              .map((slot) => (
                <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={slot.id}>
                  R{slot.round}.{slot.slotNumber}: {slot.defaultOwner.name} to {slot.currentOwner.name} ({slot.overrideOwnerCode})
                </div>
              ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Manage keepers</h2>
          <form action={createKeeper} className="mt-4 grid gap-3 md:grid-cols-2">
            <select className="rounded-xl border border-[var(--border)] px-3 py-2" name="ownerId">
              {snapshot.owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
            <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="round" placeholder="Round" type="number" />
            <input className="rounded-xl border border-[var(--border)] px-3 py-2 md:col-span-2" name="playerName" placeholder="Player name" type="text" />
            <select className="rounded-xl border border-[var(--border)] px-3 py-2" name="sport">
              {SPORTS.map((sport) => (
                <option key={sport} value={sport}>
                  {sportWithEmoji(sport)}
                </option>
              ))}
            </select>
            <input className="rounded-xl border border-[var(--border)] px-3 py-2" name="tag" placeholder="Tag (K1/K2/etc)" type="text" />
            <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white md:col-span-2" type="submit">
              Add keeper
            </button>
          </form>

          <div className="mt-4 space-y-2 text-sm">
            {snapshot.keepers.map((keeper) => (
              <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={keeper.id}>
                {keeper.playerName} • {keeper.owner.name} • {sportWithEmoji(keeper.sport as Sport)}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Owners and codes</h2>
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

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {snapshot.owners.map((owner) => (
              <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={owner.id}>
                <p className="font-semibold">{owner.name}</p>
                <p className="text-sm text-[var(--muted)]">
                  {snapshot.ownerCodes
                    .filter((code) => code.ownerId === owner.id)
                    .map((code) => code.code)
                    .join(", ")}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Spreadsheet import</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Paste CSV-style rows in the format <code>round,slot,value</code>, for example <code>3,4,(ME) ⚾️ Player Name</code>.
          </p>
          <form action={importSpreadsheetText} className="mt-4 space-y-3">
            <textarea className="min-h-56 w-full rounded-2xl border border-[var(--border)] px-4 py-3" name="importText" placeholder={"1,1,(ME) ⚾️ Player Name\n1,2,🏒 Player Name"} />
            <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" type="submit">
              Import rows
            </button>
          </form>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Export and reset</h2>
          <div className="mt-4 space-y-3">
            <a className="inline-flex rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/api/export">
              Download CSV export
            </a>
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
