import { NextResponse, type NextRequest } from "next/server";
import { runFundingChargeJob } from "@/lib/stripe/charges";
import { stripeConfigured } from "@/lib/stripe/server";

/**
 * Deadline charge job (flow #4). Vercel Cron hits this on the schedule in
 * vercel.json with "Authorization: Bearer $CRON_SECRET" — same gate as the
 * notifications cron. At each run: claim every collecting funding_request
 * whose real funding_deadline has passed, fire its off-session charges (or
 * fail it if it isn't fully mandated), and settle refunds on any failed
 * batch. Charging never depends on someone loading a page.
 *
 * Safe to call repeatedly (manual test runs included): claiming is atomic
 * in begin_funding_charge_batch() and every Stripe write is idempotent.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!stripeConfigured()) {
    return NextResponse.json({ skipped: "stripe not configured in this environment" });
  }

  try {
    const summary = await runFundingChargeJob();
    if (summary.errors.length) console.error("[funding-charges] errors", summary.errors);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[funding-charges] job failed", err);
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
}
