import { Sport } from "@prisma/client";

import {
  approveKeeperSubmission,
  importFullKeeperGridText,
  importKeeperText,
  importPlayerDatabaseText,
  importTradedPicksText,
  rejectKeeperSubmission,
  resolveKeeperImportIssue,
} from "@/components/keepers/keeper-actions";
import { DraftOrderForm } from "@/components/keepers/draft-order-form";
import { Card } from "@/components/ui/card";
import { SPORTS } from "@/lib/constants/league";
import { prisma } from "@/lib/db/prisma";
import { getLeagueSnapshot } from "@/lib/draft/service";
import { sportWithEmoji } from "@/lib/utils/format";

const SAMPLE_KEEPER_TEXT = `3 Nathan Mackinnon (K4) (CM)
5 Mitch Marner (K1) (CM)
12 Paolo Banchero (K3)
14 Clayton Keller (K1), Tage Thompson (K1) (JR)`;

const SAMPLE_FULL_GRID_TEXT = `Round\tMartins\tMatt\tZolt
1\t\t\t
2\t\t(RH)\t
3\tNathan Mackinnon (K4) (CM)\t\t
4\t\t\t(RH)
5\tMitch Marner (K1) (CM)\t\t`;

type KeeperIssuePayload = {
  status?: string;
  ownerId?: string;
  ownerName?: string;
  reason?: string;
  entry?: {
    round?: number;
    rawValue?: string;
    playerName?: string | null;
    sport?: Sport | null;
    keeperTag?: string | null;
    pickOwnerCode?: string | null;
  };
};

type KeeperSubmissionPayload = {
  ownerId?: string;
  ownerName?: string;
  importedCount?: number;
  issueCount?: number;
  submittedAt?: string;
};

type KeeperApprovalPayload = {
  ownerId?: string;
  ownerName?: string;
  approvedAt?: string;
};

type KeeperFullGridImportLogPayload = {
  importedTotal?: number;
  issueCount?: number;
  rowCount?: number;
  ownerColumnCount?: number;
  importedAt?: string;
  topIssueReasons?: Array<{
    reason?: string;
    count?: number;
  }>;
  placementSamples?: Array<{
    playerName?: string;
    round?: number;
    originalPickOwner?: string;
    assignedOwner?: string;
    ownerCode?: string | null;
    rawValue?: string;
  }>;
  importedCountByOwner?: Array<{
    ownerId?: string;
    ownerName?: string;
    importedCount?: number;
    k4Count?: number;
  }>;
};

function getIssuePayload(value: unknown) {
  return (value ?? {}) as KeeperIssuePayload;
}

function getSubmissionPayload(value: unknown) {
  return (value ?? {}) as KeeperSubmissionPayload;
}

function getApprovalPayload(value: unknown) {
  return (value ?? {}) as KeeperApprovalPayload;
}

function getFullGridImportLogPayload(value: unknown) {
  return (value ?? {}) as KeeperFullGridImportLogPayload;
}

export async function KeeperWorkspace({
  feedback,
}: {
  feedback?: {
    status?: string;
    message?: string;
  };
}) {
  const [snapshot, importRecords, playerCount] = await Promise.all([
    getLeagueSnapshot(),
    prisma.importedRecord.findMany({
      where: {
        recordType: {
          in: ["keeper_import_issue", "keeper_import_submission", "keeper_import_approval", "keeper_full_grid_import_log"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.player.count(),
  ]);
  const roundOneSlots = snapshot.slots.filter((slot) => slot.round === 1).sort((left, right) => left.slotNumber - right.slotNumber);
  const orderedOwners =
    roundOneSlots.length === snapshot.owners.length
      ? roundOneSlots.map((slot) => slot.defaultOwner)
      : snapshot.owners.sort((left, right) => left.name.localeCompare(right.name));
  const orderedOwnerIds = orderedOwners.map((owner) => owner.id);
  const maxRound = snapshot.settings.totalRounds;
  const slotsByRoundAndOwner = new Map(snapshot.slots.map((slot) => [`${slot.round}:${slot.defaultOwnerId}`, slot]));
  const openIssues = importRecords
    .filter((record) => record.recordType === "keeper_import_issue")
    .map((record) => ({ record, payload: getIssuePayload(record.normalizedPayload) }))
    .filter((issue) => issue.payload.status === "open");
  const issueCountByOwnerId = openIssues.reduce((counts, issue) => {
    const ownerId = issue.payload.ownerId;
    if (ownerId) {
      counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
    }

    return counts;
  }, new Map<string, number>());
  const latestSubmissionByOwnerId = new Map<string, KeeperSubmissionPayload>();
  const latestApprovalByOwnerId = new Map<string, KeeperApprovalPayload>();
  const latestFullGridImportLog = importRecords.find((record) => record.recordType === "keeper_full_grid_import_log");
  const latestFullGridImportLogPayload = latestFullGridImportLog ? getFullGridImportLogPayload(latestFullGridImportLog.normalizedPayload) : null;

  for (const record of importRecords.filter((entry) => entry.recordType === "keeper_import_submission")) {
    const payload = getSubmissionPayload(record.normalizedPayload);
    if (payload.ownerId && !latestSubmissionByOwnerId.has(payload.ownerId)) {
      latestSubmissionByOwnerId.set(payload.ownerId, payload);
    }
  }

  for (const record of importRecords.filter((entry) => entry.recordType === "keeper_import_approval")) {
    const payload = getApprovalPayload(record.normalizedPayload);
    if (payload.ownerId && !latestApprovalByOwnerId.has(payload.ownerId)) {
      latestApprovalByOwnerId.set(payload.ownerId, payload);
    }
  }

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <h2 className="text-xl font-semibold">Pre-draft imports</h2>
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <h3 className="font-semibold text-amber-950">Full grid override</h3>
            <p className="mt-1 text-sm text-amber-900">
              Paste the whole keeper grid from Google Sheets. This clears current keeper imports and rebuilds keepers/traded-pick overrides from the grid.
            </p>
            <form action={importFullKeeperGridText} className="mt-3 space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-900">Fallback sport</span>
                <select className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2" name="fallbackSport">
                  <option value="">Use player DB or flag</option>
                  {SPORTS.map((sport) => (
                    <option key={sport} value={sport}>
                      {sportWithEmoji(sport)}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                className="min-h-52 w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 font-mono text-sm"
                name="fullKeeperGridText"
                placeholder={SAMPLE_FULL_GRID_TEXT}
              />
              <button className="rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white" type="submit">
                Import full grid and override keepers
              </button>
            </form>
          </div>

          {latestFullGridImportLogPayload ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold">Latest full-grid import log</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Imported {latestFullGridImportLogPayload.importedTotal ?? 0} keepers across {latestFullGridImportLogPayload.ownerColumnCount ?? 0} owner columns.
                  </p>
                </div>
                <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-xs font-semibold">
                  {latestFullGridImportLogPayload.issueCount ?? 0} issue{latestFullGridImportLogPayload.issueCount === 1 ? "" : "s"}
                </span>
              </div>

              {latestFullGridImportLogPayload.topIssueReasons && latestFullGridImportLogPayload.topIssueReasons.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {latestFullGridImportLogPayload.topIssueReasons.map((entry, index) => (
                    <div className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm" key={`${entry.reason}-${index}`}>
                      <span className="font-semibold">{entry.count ?? 0}x</span> {entry.reason ?? "Unknown issue"}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">No logged issue reasons from the last full-grid import.</p>
              )}

              {latestFullGridImportLogPayload.importedCountByOwner && latestFullGridImportLogPayload.importedCountByOwner.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {latestFullGridImportLogPayload.importedCountByOwner.map((entry) => (
                    <div className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs" key={entry.ownerId ?? entry.ownerName}>
                      <span className="font-semibold">{entry.ownerName}</span>: {entry.importedCount ?? 0} imported, {entry.k4Count ?? 0} K4
                    </div>
                  ))}
                </div>
              ) : null}

              {latestFullGridImportLogPayload.placementSamples && latestFullGridImportLogPayload.placementSamples.length > 0 ? (
                <details className="mt-3 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-semibold">Show sample placements</summary>
                  <div className="mt-3 space-y-2">
                    {latestFullGridImportLogPayload.placementSamples.map((entry, index) => (
                      <div className="rounded-lg bg-[var(--surface-strong)] px-3 py-2" key={`${entry.playerName}-${index}`}>
                        <p className="font-semibold">{entry.playerName}</p>
                        <p className="text-xs text-[var(--muted)]">
                          Round {entry.round} · original pick {entry.originalPickOwner} · assigned to {entry.assignedOwner}
                          {entry.ownerCode ? ` using (${entry.ownerCode})` : ""}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{entry.rawValue}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          <form action={importKeeperText} className="mt-4 space-y-4">
            <div>
              <h3 className="font-semibold">Single-owner keeper import</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">Use this if you want to add or retest one owner at a time.</p>
            </div>
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
                  <option value="">Use player DB or flag</option>
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

          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <h3 className="text-base font-semibold">Import traded picks</h3>
            <form action={importTradedPicksText} className="mt-3 space-y-3">
              <textarea
                className="min-h-40 w-full rounded-2xl border border-[var(--border)] px-4 py-3 font-mono text-sm"
                name="tradedPicksText"
                placeholder={"Matt\tZolt\tMac\tHoff\n\t\t(JR)\n\t\t(RH)"}
              />
              <button className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold" type="submit">
                Import traded picks
              </button>
            </form>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Pre-draft validation</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">Track owner submissions, keeper counts, unresolved rows, and commissioner approval.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" href="/api/export">
                Board CSV
              </a>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {orderedOwners.map((owner) => {
              const keeperCount = snapshot.keepers.filter((keeper) => keeper.ownerId === owner.id).length;
              const k4Count = snapshot.keepers.filter((keeper) => keeper.ownerId === owner.id && keeper.tag === "K4").length;
              const expectedKeeperCount = k4Count > 0 ? 26 : 25;
              const openIssueCount = issueCountByOwnerId.get(owner.id) ?? 0;
              const submission = latestSubmissionByOwnerId.get(owner.id);
              const approval = latestApprovalByOwnerId.get(owner.id);
              const approvedAt = approval?.approvedAt ? new Date(approval.approvedAt).getTime() : 0;
              const submittedAt = submission?.submittedAt ? new Date(submission.submittedAt).getTime() : 0;
              const isApproved = Boolean(approval && approvedAt >= submittedAt);
              const isValidated = Boolean(submission && openIssueCount === 0 && keeperCount === expectedKeeperCount);
              const borderClass = isValidated
                ? "border-emerald-200 bg-emerald-50"
                : isApproved
                  ? "border-sky-200 bg-sky-50"
                  : submission
                    ? "border-amber-200 bg-amber-50"
                    : "border-[var(--border)]";

              return (
                <div className={`rounded-2xl border px-4 py-3 ${borderClass}`} key={owner.id}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{owner.name}</p>
                    <p className="text-sm text-[var(--muted)]">{keeperCount}/{expectedKeeperCount}</p>
                  </div>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {isValidated ? "Validated" : isApproved ? "Approved" : submission ? "Needs review" : "Not submitted"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{openIssueCount} unresolved</span>
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{k4Count} K4</span>
                    {submission?.submittedAt ? <span className="rounded-full border border-[var(--border)] px-2.5 py-1">Submitted</span> : null}
                  </div>
                  {submission && !isValidated && !isApproved ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form action={approveKeeperSubmission}>
                        <input name="ownerId" type="hidden" value={owner.id} />
                        <button className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white" type="submit">
                          Approve
                        </button>
                      </form>
                      <form action={rejectKeeperSubmission}>
                        <input name="ownerId" type="hidden" value={owner.id} />
                        <button className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" type="submit">
                          Reject
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card>
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Unresolved keeper rows</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">Rows that need a sport, corrected pick marker, or manual review stay here until resolved.</p>
            </div>
            <p className="text-sm text-[var(--muted)]">{openIssues.length} open</p>
          </div>

          <div className="mt-5 space-y-3">
            {openIssues.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">No unresolved keeper rows.</div>
            ) : (
              openIssues.map(({ record, payload }) => (
                <div className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3" key={record.id}>
                  <div>
                    <p className="font-semibold">
                      {payload.entry?.playerName ?? payload.entry?.rawValue ?? "Unknown player"}
                      <span className="text-sm font-normal text-[var(--muted)]"> • {payload.ownerName ?? "Unknown owner"} • Round {payload.entry?.round ?? "?"}</span>
                    </p>
                    <p className="mt-1 text-sm text-amber-900">{payload.reason ?? "Needs review."}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{payload.entry?.rawValue}</p>
                  </div>
                  <form action={resolveKeeperImportIssue} className="grid gap-2 md:grid-cols-[96px_110px_110px_1fr_auto_auto] md:items-end">
                    <input name="issueId" type="hidden" value={record.id} />
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Round</span>
                      <input
                        className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm"
                        defaultValue={payload.entry?.round && payload.entry.round > 0 ? payload.entry.round : ""}
                        name="round"
                        type="number"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Status</span>
                      <select className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm" defaultValue={payload.entry?.keeperTag ?? "K1"} name="keeperTag">
                        {["K1", "K2", "K3", "K4"].map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Sport</span>
                      <select className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm" defaultValue={payload.entry?.sport ?? SPORTS[0]} name="sport">
                      {SPORTS.map((sport) => (
                        <option key={sport} value={sport}>
                          {sportWithEmoji(sport)}
                        </option>
                      ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Pick owner code</span>
                      <input
                        className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm uppercase"
                        defaultValue={payload.entry?.pickOwnerCode ?? ""}
                        name="pickOwnerCode"
                        placeholder="JM"
                        type="text"
                      />
                    </label>
                    <button className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" name="issueAction" type="submit" value="resolve">
                      Apply
                    </button>
                    <button className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold" name="issueAction" type="submit" value="ignore">
                      Ignore
                    </button>
                  </form>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Player database</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{playerCount} players stored. Add rows as names come in so future keeper imports can match sports automatically.</p>
          <form action={importPlayerDatabaseText} className="mt-4 space-y-3">
            <textarea
              className="min-h-48 w-full rounded-2xl border border-[var(--border)] px-4 py-3 font-mono text-sm"
              name="playerDatabaseText"
              placeholder={"Nathan MacKinnon,NHL\nPaolo Banchero NBA\nJac Caglianone MLB"}
            />
            <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
              Import player rows
            </button>
          </form>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Post-draft exports</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">Download Google Sheet-ready CSV files after the draft.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/api/export?view=keeper-grid">
              Keeper grid TSV
            </a>
            <a className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/api/export">
              Draft board CSV
            </a>
            <a className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold" href="/api/export?view=rosters">
              Rosters CSV
            </a>
          </div>
        </div>
      </Card>

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
