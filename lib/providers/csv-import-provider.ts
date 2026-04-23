import { LeagueProvider, ProviderLeagueSnapshot } from "@/lib/providers/base";

export class CSVImportProvider implements LeagueProvider {
  readonly name = "CSVImportProvider";

  async fetchLeagueSnapshot(): Promise<ProviderLeagueSnapshot> {
    return {
      standings: [],
      transactions: [],
      activity: [],
    };
  }
}
