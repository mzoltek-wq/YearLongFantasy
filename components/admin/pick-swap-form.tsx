"use client";

import { useMemo, useState } from "react";

type OwnerOption = {
  id: string;
  name: string;
  code: string;
};

export type PickSwapOption = {
  id: string;
  year: number;
  ownerId: string;
  round: number;
  overallPickNumber: number;
  originalOwnerName: string;
  originalOwnerCode: string;
  selectedPlayerName: string | null;
};

type PickSwapFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  owners: OwnerOption[];
  years: number[];
  defaultYear: number;
  options: PickSwapOption[];
  openPickCount: number;
};

function getRoundMatches(options: PickSwapOption[], year: number, ownerId: string, round: string) {
  const roundNumber = Number(round);

  if (!Number.isInteger(roundNumber) || roundNumber <= 0 || !ownerId) {
    return [];
  }

  return options.filter((option) => option.year === year && option.ownerId === ownerId && option.round === roundNumber);
}

function PickChoice({
  fieldName,
  matches,
}: {
  fieldName: string;
  matches: PickSwapOption[];
}) {
  if (matches.length === 0) {
    return null;
  }

  const openMatches = matches.filter((match) => !match.selectedPlayerName);

  if (matches.length === 1) {
    const match = matches[0];

    return (
      <>
        <input name={fieldName} type="hidden" value={match.overallPickNumber} />
        <p className={match.selectedPlayerName ? "text-xs font-semibold text-rose-800" : "text-xs text-[var(--muted)]"}>
          {match.selectedPlayerName
            ? `That round pick is already used on ${match.selectedPlayerName}.`
            : `Will trade overall ${match.overallPickNumber}, originally ${match.originalOwnerName}'s pick.`}
        </p>
      </>
    );
  }

  return (
    <label className="block space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">Which pick in that round?</span>
      <select className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm" name={fieldName} required>
        <option value="">Choose exact pick</option>
        {matches.map((match) => (
          <option disabled={Boolean(match.selectedPlayerName)} key={match.id} value={match.overallPickNumber}>
            {match.originalOwnerCode === match.originalOwnerName
              ? `Overall ${match.overallPickNumber} - original ${match.originalOwnerName}`
              : `Overall ${match.overallPickNumber} - original ${match.originalOwnerName} (${match.originalOwnerCode})`}
            {match.selectedPlayerName ? ` - used on ${match.selectedPlayerName}` : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-amber-900">
        {openMatches.length} open pick{openMatches.length === 1 ? "" : "s"} found in this owner/round. Used picks are shown but cannot be selected.
      </p>
    </label>
  );
}

export function PickSwapForm({ action, owners, years, defaultYear, options, openPickCount }: PickSwapFormProps) {
  const [year, setYear] = useState(defaultYear);
  const [leftOwnerId, setLeftOwnerId] = useState(owners[0]?.id ?? "");
  const [rightOwnerId, setRightOwnerId] = useState(owners[1]?.id ?? owners[0]?.id ?? "");
  const [leftRound, setLeftRound] = useState("");
  const [rightRound, setRightRound] = useState("");
  const leftMatches = useMemo(() => getRoundMatches(options, year, leftOwnerId, leftRound), [leftOwnerId, leftRound, options, year]);
  const rightMatches = useMemo(() => getRoundMatches(options, year, rightOwnerId, rightRound), [rightOwnerId, rightRound, options, year]);

  return (
    <>
      <form action={action} className="mt-4 space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Draft year</span>
          <select
            className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
            name="year"
            onChange={(event) => setYear(Number(event.target.value))}
            value={year}
          >
            {years.map((optionYear) => (
              <option key={optionYear} value={optionYear}>
                {optionYear}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 md:grid-cols-[1fr_0.7fr]">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Owner giving pick</span>
            <select className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="leftOwnerId" onChange={(event) => setLeftOwnerId(event.target.value)} value={leftOwnerId}>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name} ({owner.code})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Round</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
              name="leftRound"
              onChange={(event) => setLeftRound(event.target.value)}
              placeholder="75"
              type="number"
              value={leftRound}
            />
          </label>
        </div>
        <PickChoice fieldName="leftOverallPickNumber" matches={leftMatches} />

        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
          swaps with
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_0.7fr]">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Owner giving pick</span>
            <select className="w-full rounded-xl border border-[var(--border)] px-3 py-2" name="rightOwnerId" onChange={(event) => setRightOwnerId(event.target.value)} value={rightOwnerId}>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name} ({owner.code})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Round</span>
            <input
              className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
              name="rightRound"
              onChange={(event) => setRightRound(event.target.value)}
              placeholder="53"
              type="number"
              value={rightRound}
            />
          </label>
        </div>
        <PickChoice fieldName="rightOverallPickNumber" matches={rightMatches} />

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
        {openPickCount} picks are currently open. Enter a round number, not an overall pick number. If that owner has multiple picks in the round, this form will ask which exact pick to trade.
      </div>
    </>
  );
}
