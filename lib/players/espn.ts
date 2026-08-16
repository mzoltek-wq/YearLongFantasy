import { Sport } from "@prisma/client";

import { ImportablePlayerRecord } from "@/lib/players/import";

type EspnSportConfig = {
  game: string;
  sport: Sport;
  label: string;
  positions: Record<number, string>;
};

const ESPN_SPORTS: EspnSportConfig[] = [
  {
    game: "ffl",
    sport: Sport.FOOTBALL,
    label: "Football",
    positions: {
      1: "QB",
      2: "RB",
      3: "WR",
      4: "TE",
      5: "K",
      16: "DST",
      23: "FLEX",
    },
  },
  {
    game: "flb",
    sport: Sport.BASEBALL,
    label: "Baseball",
    positions: {
      0: "C",
      1: "1B",
      2: "2B",
      3: "3B",
      4: "SS",
      5: "OF",
      7: "DH",
      8: "SP",
      9: "RP",
      10: "P",
      11: "IF",
      12: "UTIL",
    },
  },
  {
    game: "fba",
    sport: Sport.BASKETBALL,
    label: "Basketball",
    positions: {
      1: "PG",
      2: "SG",
      3: "SF",
      4: "PF",
      5: "C",
      11: "G",
      12: "F",
    },
  },
  {
    game: "fhl",
    sport: Sport.HOCKEY,
    label: "Hockey",
    positions: {
      1: "C",
      2: "LW",
      3: "RW",
      4: "D",
      5: "G",
    },
  },
];
const ESPN_BASE_URLS = ["https://lm-api-reads.fantasy.espn.com", "https://fantasy.espn.com"];

type EspnPlayerNode = {
  id?: number;
  fullName?: string;
  defaultPositionId?: number;
  eligibleSlots?: number[];
  proTeamId?: number;
};

export type EspnPlayerFetchResult = {
  records: ImportablePlayerRecord[];
  failures: Array<{ sport: string; status?: number; message: string }>;
};

export async function fetchEspnPlayerRecords({ season, limit = 2500 }: { season: number; limit?: number }): Promise<EspnPlayerFetchResult> {
  const records: ImportablePlayerRecord[] = [];
  const failures: EspnPlayerFetchResult["failures"] = [];

  for (const config of ESPN_SPORTS) {
    const filters = {
      players: {
        filterActive: { value: true },
        limit,
        sortPercOwned: {
          sortPriority: 4,
          sortAsc: false,
        },
      },
    };

    try {
      const response = await fetchEspnSportResponse(config, season, filters);

      const data = (await response.json()) as { players?: Array<{ player?: EspnPlayerNode }> };
      const sportRecords = (data.players ?? []).flatMap((entry) => {
        const player = entry.player;
        if (!player?.fullName) {
          return [];
        }

        const primaryPosition = mapEspnPosition(config, player.defaultPositionId);
        const eligiblePositions = (player.eligibleSlots ?? [])
          .map((slot) => mapEspnPosition(config, slot))
          .filter((position): position is string => Boolean(position))
          .filter((position) => !["FLEX", "OP", "UTIL", "IF", "P"].includes(position));

        return [
          {
            displayName: player.fullName,
            sport: config.sport,
            espnId: player.id ?? null,
            primaryPosition,
            eligiblePositions: Array.from(new Set([primaryPosition, ...eligiblePositions].filter(Boolean) as string[])),
            source: "ESPN",
            raw: {
              defaultPositionId: player.defaultPositionId ?? null,
              eligibleSlots: player.eligibleSlots ?? [],
              espnId: player.id ?? null,
              proTeamId: player.proTeamId ?? null,
            },
          },
        ];
      });

      records.push(...sportRecords);
    } catch (error) {
      failures.push({ sport: config.label, message: error instanceof Error ? error.message : "ESPN request failed" });
    }
  }

  return { records, failures };
}

async function fetchEspnSportResponse(config: EspnSportConfig, season: number, filters: unknown) {
  let lastResponse: Response | null = null;

  for (const baseUrl of ESPN_BASE_URLS) {
    for (const leagueDefaultId of [1, 3, 4]) {
      const url = `${baseUrl}/apis/v3/games/${config.game}/seasons/${season}/segments/0/leaguedefaults/${leagueDefaultId}?view=kona_player_info`;
      const response = await fetch(url, {
        headers: {
          "x-fantasy-filter": JSON.stringify(filters),
        },
        cache: "no-store",
        redirect: "follow",
      });

      if (response.ok) {
        return response;
      }

      lastResponse = response;
    }
  }

  throw new Error(lastResponse ? `${lastResponse.status} ${lastResponse.statusText}` : "ESPN request failed");
}

function mapEspnPosition(config: EspnSportConfig, id: number | undefined) {
  return id == null ? null : config.positions[id] ?? null;
}
