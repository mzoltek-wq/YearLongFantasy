"use client";

import { Owner } from "@prisma/client";

import { updateDraftOrder } from "@/components/keepers/keeper-actions";

export function DraftOrderForm({
  owners,
  orderedOwnerIds,
}: {
  owners: Owner[];
  orderedOwnerIds: string[];
}) {
  return (
    <form
      action={updateDraftOrder}
      className="mt-4 space-y-4"
      onSubmit={(event) => {
        if (!window.confirm("Saving draft order will reset the entire draft board, including current keepers and picks. Continue?")) {
          event.preventDefault();
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <label className="space-y-1" key={index}>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Pick {index + 1}</span>
            <select className="w-full rounded-xl border border-[var(--border)] px-3 py-2" defaultValue={orderedOwnerIds[index] ?? ""} name={`owner-${index}`}>
              <option value="">Choose owner</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
        Save draft order and reset board
      </button>
    </form>
  );
}
