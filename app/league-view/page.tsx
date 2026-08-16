import { notFound } from "next/navigation";

import { ReadOnlyLeagueView } from "@/components/league/read-only-league-view";
import { getLeagueSnapshot } from "@/lib/draft/service";
import { getDraftHistoryGridData } from "@/lib/league/draft-history";

export const dynamic = "force-dynamic";

export default async function LeagueViewPage() {
  const year = new Date().getFullYear();
  const [draftSnapshot, draftHistory] = await Promise.all([getLeagueSnapshot(), getDraftHistoryGridData(year)]);

  if (!draftHistory) {
    notFound();
  }

  return <ReadOnlyLeagueView draftHistory={draftHistory} draftSnapshot={draftSnapshot} />;
}
