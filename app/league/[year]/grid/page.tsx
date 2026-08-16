import { notFound } from "next/navigation";

import { DraftHistoryGrid } from "@/components/league/draft-history-grid";
import { Card } from "@/components/ui/card";
import { getDraftHistoryGridData } from "@/lib/league/draft-history";

export const dynamic = "force-dynamic";

export default async function LeagueGridPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams?: Promise<{ status?: string; message?: string }>;
}) {
  const { year: yearParam } = await params;
  const feedback = await searchParams;
  const year = Number(yearParam);

  if (!Number.isInteger(year)) {
    notFound();
  }

  const draftHistory = await getDraftHistoryGridData(year);

  if (!draftHistory) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {feedback?.message ? (
        <Card className={feedback.status === "error" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}>
          <p className={`text-sm font-medium ${feedback.status === "error" ? "text-rose-900" : "text-emerald-900"}`}>{feedback.message}</p>
        </Card>
      ) : null}

      <DraftHistoryGrid {...draftHistory} />
    </div>
  );
}
