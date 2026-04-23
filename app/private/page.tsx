import { Card } from "@/components/ui/card";
import { PrivateWorkspace } from "@/components/private/private-workspace";

export const dynamic = "force-dynamic";

export default function PrivatePage() {
  return (
    <div className="space-y-6">
      <Card>
        <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Private workspace</p>
        <h2 className="mt-2 text-2xl font-semibold">Owner-only draft assistant scaffold</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          This page is intentionally scaffolded for Phase 3: private rankings, watchlist, notes, and strategy stay separate from the shared league views.
        </p>
      </Card>
      <PrivateWorkspace />
    </div>
  );
}
