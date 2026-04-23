import { OwnerDashboardTable } from "@/components/dashboard/owner-dashboard-table";
import { Card } from "@/components/ui/card";
import { getLeagueSnapshot } from "@/lib/draft/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snapshot = await getLeagueSnapshot();

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">League totals</p>
        <h2 className="mt-2 text-2xl font-semibold">Owner validation dashboard</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Yellow means the owner or sport is still below the configured target, green is exactly on target, and red means the configured limit has been exceeded.
        </p>
      </Card>
      <OwnerDashboardTable snapshot={snapshot} />
    </div>
  );
}
