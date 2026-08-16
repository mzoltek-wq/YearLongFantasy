import { RosterView } from "@/components/league/roster-view";
import { getLeagueSnapshot } from "@/lib/draft/service";

export const dynamic = "force-dynamic";

export default async function RostersPage() {
  const snapshot = await getLeagueSnapshot();

  return <RosterView snapshot={snapshot} />;
}
