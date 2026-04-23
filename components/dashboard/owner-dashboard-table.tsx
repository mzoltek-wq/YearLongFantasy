import Link from "next/link";

import { SPORTS } from "@/lib/constants/league";
import type { LeagueSnapshot } from "@/lib/types/draft";
import { SPORT_LABELS } from "@/lib/constants/league";
import { StatusChip } from "@/components/ui/status-chip";

export function OwnerDashboardTable({ snapshot }: { snapshot: LeagueSnapshot }) {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[var(--surface-strong)]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Owner</th>
                {SPORTS.map((sport) => (
                  <th className="px-4 py-3 text-left font-semibold" key={sport}>
                    {SPORT_LABELS[sport]}
                  </th>
                ))}
                <th className="px-4 py-3 text-left font-semibold">Total</th>
                <th className="px-4 py-3 text-left font-semibold">Picks left</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.ownerTotals.map((row) => (
                <tr className="border-t border-[var(--border)]" key={row.owner.id}>
                  <td className="px-4 py-3 font-semibold">
                    <Link className="hover:text-[var(--accent)]" href={`/owners/${row.owner.id}`}>
                      {row.owner.name}
                    </Link>
                  </td>
                  {SPORTS.map((sport) => (
                    <td className="space-y-2 px-4 py-3" key={sport}>
                      <div className="font-semibold">
                        {row.bySport[sport].count}/{row.bySport[sport].limit}
                      </div>
                      <StatusChip
                        label={
                          row.bySport[sport].status === "below"
                            ? "Below"
                            : row.bySport[sport].status === "exact"
                              ? "Exact"
                              : "Over"
                        }
                        status={row.bySport[sport].status}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="font-semibold">{row.totalSelected}</div>
                    <StatusChip
                      label={row.totalStatus === "below" ? "Below" : row.totalStatus === "exact" ? "Exact" : "Over"}
                      status={row.totalStatus}
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold">{row.picksLeft}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--border)] bg-[var(--surface-strong)] font-semibold">
                <td className="px-4 py-3">TOTAL</td>
                {snapshot.leagueTotals.bySport.map((entry) => (
                  <td className="space-y-2 px-4 py-3" key={entry.sport}>
                    <div>
                      {entry.drafted}/{entry.target}
                    </div>
                    <StatusChip
                      label={entry.status === "below" ? "Below" : entry.status === "exact" ? "Exact" : "Over"}
                      status={entry.status}
                    />
                  </td>
                ))}
                <td className="px-4 py-3">{snapshot.slots.filter((slot) => slot.selectedPlayerName).length}</td>
                <td className="px-4 py-3">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
