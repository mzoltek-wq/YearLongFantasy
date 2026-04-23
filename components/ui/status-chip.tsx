import { OwnerSportStatus } from "@/lib/validation/draft";

import { cn } from "@/lib/utils/format";

export function StatusChip({ status, label }: { status: OwnerSportStatus; label: string }) {
  const classes = {
    below: "bg-amber-100 text-amber-800",
    exact: "bg-emerald-100 text-emerald-800",
    over: "bg-rose-100 text-rose-800",
  };

  return <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", classes[status])}>{label}</span>;
}
