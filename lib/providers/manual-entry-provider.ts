import { LeagueProvider, ProviderLeagueSnapshot } from "@/lib/providers/base";

export class ManualEntryProvider implements LeagueProvider {
  readonly name = "ManualEntryProvider";

  async fetchLeagueSnapshot(): Promise<ProviderLeagueSnapshot> {
    return {
      standings: [],
      transactions: [],
      activity: [],
    };
  }
}
