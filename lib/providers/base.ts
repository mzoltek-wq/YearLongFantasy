export type ProviderLeagueSnapshot = {
  standings?: unknown[];
  transactions?: unknown[];
  activity?: unknown[];
};

export interface LeagueProvider {
  readonly name: string;
  fetchLeagueSnapshot(): Promise<ProviderLeagueSnapshot>;
}
