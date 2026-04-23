import { LeagueProvider, ProviderLeagueSnapshot } from "@/lib/providers/base";

export class ESPNProvider implements LeagueProvider {
  readonly name = "ESPNProvider";

  async fetchLeagueSnapshot(): Promise<ProviderLeagueSnapshot> {
    return {
      standings: [],
      transactions: [],
      activity: [],
    };
  }
}
