import { Card } from "@/components/ui/card";
import { addManualPlayer, clearPlayerPositionOverride, importEspnPlayers, importPlayersText, updatePlayerPositionOverride } from "@/components/players/player-actions";
import { PlayerBrowser, PlayerBrowserRow } from "@/components/players/player-browser";
import { prisma } from "@/lib/db/prisma";
import { SPORT_EMOJIS, SPORT_LABELS, SPORTS } from "@/lib/constants/league";
import { extractPositionsFromMetadata, POSITION_OPTIONS_BY_SPORT } from "@/lib/roster/positions";

export const dynamic = "force-dynamic";

type PlayersPageProps = {
  searchParams?: Promise<{ status?: string; message?: string }>;
};

export default async function PlayersPage({ searchParams }: PlayersPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const players = await prisma.player.findMany({
    select: {
      id: true,
      displayName: true,
      sport: true,
      metadata: true,
      updatedAt: true,
    },
    orderBy: [{ sport: "asc" }, { displayName: "asc" }],
  });
  const browserRows: PlayerBrowserRow[] = players.map((player) => {
    const metadata = player.metadata && typeof player.metadata === "object" ? (player.metadata as Record<string, unknown>) : {};

    return {
      id: player.id,
      displayName: player.displayName,
      sport: player.sport,
      positions: extractPositionsFromMetadata(player.sport, player.metadata),
      team: typeof metadata.team === "string" ? metadata.team : null,
      espnId: typeof metadata.espnId === "string" ? metadata.espnId : null,
      source: typeof metadata.source === "string" ? metadata.source : null,
      hasManualPositionOverride: Array.isArray(metadata.manualPositions) && metadata.manualPositions.length > 0,
      updatedAt: player.updatedAt.toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Data tools</p>
          <h1 className="mt-2 text-3xl font-semibold">Players</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            Import ESPN-style player eligibility, then filter by sport and position to verify the draft entry auto-resolver.
          </p>
        </div>
      </div>

      {resolvedSearchParams.message ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            resolvedSearchParams.status === "error" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {resolvedSearchParams.message}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="text-xl font-semibold">Add manual player</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Use this for missing players or bad ESPN imports. ESPN ID can stay blank; source will be saved as Manual.
          </p>
          <form action={addManualPlayer} className="mt-4 space-y-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Player name</span>
              <input className="w-full rounded-2xl border border-[var(--border)] px-4 py-3" name="displayName" placeholder="Kyler Murray" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Sport</span>
              <select className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3" name="sport">
                {SPORTS.map((sport) => (
                  <option key={sport} value={sport}>
                    {SPORT_EMOJIS[sport]} {SPORT_LABELS[sport]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Position(s)</span>
              <input className="w-full rounded-2xl border border-[var(--border)] px-4 py-3" name="positions" placeholder="QB or RB, WR" />
            </label>
            <p className="text-xs text-[var(--muted)]">
              Valid examples: Football {POSITION_OPTIONS_BY_SPORT.FOOTBALL.join(", ")}; Baseball {POSITION_OPTIONS_BY_SPORT.BASEBALL.join(", ")}.
            </p>
            <button className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white" type="submit">
              Save manual player
            </button>
          </form>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Import from ESPN public endpoint</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            This tries the same public ESPN fantasy player endpoint from the script, then saves player IDs and eligible positions into the app database.
          </p>
          <form action={importEspnPlayers} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Season</span>
              <input className="w-full rounded-2xl border border-[var(--border)] px-4 py-3" defaultValue={2026} min={2020} name="season" type="number" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Limit per sport</span>
              <input className="w-full rounded-2xl border border-[var(--border)] px-4 py-3" defaultValue={2500} min={100} name="limit" type="number" />
            </label>
            <button className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white" type="submit">
              Fetch ESPN players
            </button>
          </form>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold">Paste player CSV/TSV</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Accepts Gemini/script output headers like Sport, Player Name, ESPN Player ID, Primary Position, Eligible Slots. Also accepts OWGR-style golf ranking CSVs with a NAME column, plus simple rows like Cale Makar,NHL,D.
          </p>
          <form action={importPlayersText} className="mt-4 space-y-3">
            <textarea
              className="min-h-40 w-full rounded-2xl border border-[var(--border)] px-4 py-3 font-mono text-sm"
              name="playerImportText"
              placeholder={"Sport,Player Name,ESPN Player ID,Primary Position,Eligible Slots\nHockey,Cale Makar,123,D,D\nBaseball,Shohei Ohtani,456,DH,\"DH, SP\"\nBasketball,Victor Wembanyama,789,C,\"C, PF\""}
            />
            <button className="rounded-full border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold" type="submit">
              Import pasted players
            </button>
          </form>
        </Card>
      </div>

      <PlayerBrowser clearPositionOverrideAction={clearPlayerPositionOverride} players={browserRows} updatePositionOverrideAction={updatePlayerPositionOverride} />
    </div>
  );
}
