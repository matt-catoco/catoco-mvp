import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { activateFromSetupIntent } from "@/lib/stripe/mandates";
import {
  handlePaymentIntentFailed,
  handlePaymentIntentSucceeded,
} from "@/lib/stripe/charges";

/**
 * Stripe webhook (flow #4). Every payload is signature-verified against
 * STRIPE_WEBHOOK_SECRET using the RAW body — an unsigned or tampered
 * request never reaches a handler. Handlers are idempotent (Stripe retries
 * and may deliver out of order), and a thrown error returns 500 so Stripe
 * retries delivery rather than the event being silently dropped.
 *
 * Subscribe the endpoint to: setup_intent.succeeded,
 * setup_intent.setup_failed, payment_intent.succeeded,
 * payment_intent.payment_failed, charge.refunded.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed", (err as Error).message);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // Belt and braces with the test-key guard in getStripe(): this build must
  // never act on a live-mode event.
  if (event.livemode) {
    console.error(`[stripe webhook] ignoring livemode event ${event.id}`);
    return NextResponse.json({ received: true, ignored: "livemode" });
  }

  const supabase = createServiceClient();
  try {
    switch (event.type) {
      case "setup_intent.succeeded":
        await activateFromSetupIntent(supabase, event.data.object);
        break;
      case "setup_intent.setup_failed": {
        const si = event.data.object;
        await supabase.rpc("record_mandate_setup_failure", {
          p_setup_intent_id: si.id,
          p_reason: si.last_setup_error?.message ?? si.last_setup_error?.code ?? "setup_failed",
        });
        break;
      }
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(supabase, event.data.object);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(supabase, event.data.object);
        break;
      case "charge.refunded": {
        const charge = event.data.object;
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        // Only a full refund settles the ledger row; batch refunds are always full.
        if (piId && charge.refunded) {
          const { error } = await supabase.rpc("record_contribution_refunded", {
            p_payment_intent_id: piId,
            p_refund_id: null,
          });
          if (error) throw new Error(`record_contribution_refunded: ${error.message}`);
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`[stripe webhook] ${event.type} ${event.id} failed`, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
