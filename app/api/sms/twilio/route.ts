import crypto from "node:crypto";

import { InboundMessageStatus, TradeSource, TradeStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const PROVIDER = "TWILIO";

export async function POST(request: Request) {
  const formData = await request.formData();
  const params = Object.fromEntries(Array.from(formData.entries()).map(([key, value]) => [key, String(value)]));

  if (!isValidTwilioRequest(request, params)) {
    return twiml("Trade text rejected: webhook signature could not be verified.", 403);
  }

  const providerMessageId = params.MessageSid || params.SmsSid || null;
  const body = (params.Body ?? "").trim();
  const fromPhone = params.From || null;
  const toPhone = params.To || null;

  if (!body) {
    return twiml("Trade text received, but it was blank. Please resend the trade details.");
  }

  if (providerMessageId) {
    const existing = await prisma.inboundMessage.findUnique({
      where: {
        provider_providerMessageId: {
          provider: PROVIDER,
          providerMessageId,
        },
      },
    });

    if (existing) {
      return twiml("Trade text was already received and is waiting for review.");
    }
  }

  const season = await prisma.leagueSeason.findFirst({
    orderBy: { year: "desc" },
  });
  const manager = fromPhone
    ? await prisma.manager.findFirst({
        where: { phoneNumber: fromPhone },
      })
    : null;

  await prisma.$transaction(async (tx) => {
    const trade = season
      ? await tx.trade.create({
          data: {
            seasonId: season.id,
            status: TradeStatus.PENDING,
            source: TradeSource.SMS,
            rawText: body,
            notes: `Inbound SMS from ${manager?.name ?? fromPhone ?? "unknown sender"}`,
          },
        })
      : null;

    await tx.inboundMessage.create({
      data: {
        seasonId: season?.id ?? null,
        source: "SMS",
        provider: PROVIDER,
        providerMessageId,
        fromPhone,
        fromName: manager?.name ?? null,
        body,
        status: InboundMessageStatus.NEEDS_REVIEW,
        relatedTradeId: trade?.id ?? null,
        parsedPayload: {
          provider: PROVIDER,
          toPhone,
          messageSid: providerMessageId,
          rawParams: params,
        },
      },
    });
  });

  return twiml("Trade text received. It has been saved for commissioner review.");
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    provider: PROVIDER,
    message: "POST Twilio incoming SMS webhooks to this endpoint.",
  });
}

function isValidTwilioRequest(request: Request, params: Record<string, string>) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    return process.env.NODE_ENV !== "production";
  }

  const signature = request.headers.get("x-twilio-signature");

  if (!signature) {
    return false;
  }

  const expected = crypto.createHmac("sha1", authToken).update(getWebhookUrl(request, params)).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function getWebhookUrl(request: Request, params: Record<string, string>) {
  const requestUrl = new URL(request.url);
  const configuredBaseUrl = process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, "");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? requestUrl.host;
  const origin = configuredBaseUrl ?? `${forwardedProto}://${forwardedHost}`;
  const publicUrl = `${origin}${requestUrl.pathname}${requestUrl.search}`;
  const sortedKeys = Object.keys(params).sort();

  return sortedKeys.reduce((signatureBase, key) => `${signatureBase}${key}${params[key]}`, publicUrl);
}

function twiml(message: string, status = 200) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`, {
    status,
    headers: {
      "Content-Type": "text/xml",
    },
  });
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
