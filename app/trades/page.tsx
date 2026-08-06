import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const [inboundMessages, trades] = await Promise.all([
    prisma.inboundMessage.findMany({
      include: {
        season: true,
        relatedTrade: true,
      },
      orderBy: { receivedAt: "desc" },
      take: 20,
    }),
    prisma.trade.findMany({
      include: {
        season: true,
        inboundMessages: true,
      },
      orderBy: { tradeDate: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Trades</p>
        <h2 className="mt-2 text-3xl font-semibold">Trade inbox and history</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          This will become the place to review trade texts, approve player and pick movement, and keep the audit trail that explains why each future draft pick moved.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="text-xl font-semibold">Incoming trade texts</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Texts received from the league trade number land here first. For now, they are raw messages waiting for commissioner review.
          </p>
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)]">
            Twilio webhook URL: <code>https://YOUR_DOMAIN/api/sms/twilio</code>
          </div>
          <div className="mt-4 space-y-3">
            {inboundMessages.length === 0 ? (
              <p className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">No trade texts have been received yet.</p>
            ) : (
              inboundMessages.map((message) => (
                <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={message.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{message.fromName ?? message.fromPhone ?? "Unknown sender"}</p>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{message.status.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {message.season?.year ?? "No season"} • {message.receivedAt.toLocaleString()} {message.relatedTrade ? "• Pending trade created" : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <h3 className="text-xl font-semibold">Trade records</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Approved/apply controls will live here later. Today this shows the pending trade shells created from SMS intake.
          </p>
          <div className="mt-4 space-y-3">
            {trades.length === 0 ? (
              <p className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">No trades have been logged yet.</p>
            ) : (
              trades.map((trade) => (
                <div className="rounded-2xl border border-[var(--border)] px-4 py-3" key={trade.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{trade.season.year} trade</p>
                    <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">{trade.status}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{trade.rawText ?? "No trade text saved."}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {trade.source} • {trade.tradeDate.toLocaleString()} • {trade.inboundMessages.length} linked message
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
