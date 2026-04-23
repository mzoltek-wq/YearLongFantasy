import { DraftBoardClient } from "@/components/draft/draft-board-client";
import { getLeagueSnapshot } from "@/lib/draft/service";

export const dynamic = "force-dynamic";

export default async function DraftPage() {
  const snapshot = await getLeagueSnapshot();

  return <DraftBoardClient initialSnapshot={snapshot} />;
}
