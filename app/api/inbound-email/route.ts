import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processInboundEmail, verifyResendSignature } from "@/lib/inbound-email";

export const maxDuration = 60;

/**
 * Resend Inbound webhook (`email.received`) for forwarded booking
 * confirmations. Signature-verified with RESEND_INBOUND_WEBHOOK_SECRET;
 * anything else is rejected before touching the database.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const raw = await request.text();
  if (!verifyResendSignature(raw, request.headers, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string; from?: string; to?: string[]; subject?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (event.type !== "email.received" || !event.data?.email_id) {
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
  }

  try {
    const result = await processInboundEmail(createServiceClient(), {
      email_id: event.data.email_id,
      from: event.data.from ?? "",
      to: event.data.to ?? [],
      subject: event.data.subject,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[inbound-email]", err);
    // 500 → Resend retries delivery.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
