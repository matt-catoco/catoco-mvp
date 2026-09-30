import "server-only";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { fromMinorUnits, getStripe, toMinorUnits } from "@/lib/stripe/server";

/**
 * The charge/refund engine for mandate-based funding (flow #4), shared by
 * the deadline cron (app/api/cron/funding-charges) and the Stripe webhook
 * (app/api/stripe/webhook). All DB writes go through service-role-only
 * security-definer RPCs (see 20260929000000_stripe_mandates.sql).
 *
 * Lifecycle of one funding_request at its deadline:
 *   1. begin_funding_charge_batch — atomically claims it. Not fully
 *      mandated -> failed right there, nothing charged.
 *   2. fireBatch — one off-session PaymentIntent per mandate, fired
 *      sequentially and STOPPING at the first failure (every charge fired
 *      after a known failure would only have to be refunded again).
 *   3. Outcomes: cards usually settle synchronously, SEPA goes to
 *      `processing` and settles by webhook minutes (test) to days (live)
 *      later. A contribution row is only ever written from a succeeded
 *      PaymentIntent (webhook, or the stale-intent reconcile below).
 *   4. Any failure -> the whole request fails and every succeeded charge in
 *      the batch is refunded through the API (refundOwedContributions); a charge
 *      still in flight that succeeds later is refunded when it lands.
 *
 * Every Stripe write carries an idempotency key derived from our own ids,
 * so a crashed/retried cron run can't double-charge or double-refund.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

type BatchMandate = {
  mandate_id: string;
  participant_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  payment_method_type: "card" | "sepa_debit" | null;
  individual_amount: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  updated_at: string;
};

// A PaymentIntent fired this long ago with no webhook outcome yet gets
// looked up directly — covers a missed/failed webhook delivery without
// racing the normal webhook path.
const STALE_INTENT_MS = 60 * 60 * 1000;

export type ChargeJobSummary = {
  claimed: { fundingRequestId: string; outcome: string | null }[];
  fired: number;
  failedBatches: string[];
  refundsRequested: number;
  errors: string[];
};

export async function runFundingChargeJob(): Promise<ChargeJobSummary> {
  const supabase = createServiceClient();
  const summary: ChargeJobSummary = { claimed: [], fired: 0, failedBatches: [], refundsRequested: 0, errors: [] };

  // 1. claim everything whose deadline has passed
  const { data: due, error: dueError } = await supabase.rpc("list_due_funding_charges");
  if (dueError) throw new Error(`list_due_funding_charges: ${dueError.message}`);
  for (const fundingRequestId of (due ?? []) as string[]) {
    const { data: outcome, error } = await supabase.rpc("begin_funding_charge_batch", {
      p_funding_request_id: fundingRequestId,
    });
    if (error) {
      summary.errors.push(`begin ${fundingRequestId}: ${error.message}`);
      continue;
    }
    summary.claimed.push({ fundingRequestId, outcome: outcome as string | null });
  }

  // 2. fire (or reconcile) every batch that's charging — includes batches a
  // previous run started but didn't finish
  const { data: charging } = await supabase.rpc("list_funding_requests_by_charge_status", {
    p_charge_status: "charging",
  });
  for (const fundingRequestId of (charging ?? []) as string[]) {
    try {
      const res = await fireBatch(supabase, fundingRequestId);
      summary.fired += res.fired;
      if (res.failed) summary.failedBatches.push(fundingRequestId);
    } catch (err) {
      summary.errors.push(`fire ${fundingRequestId}: ${(err as Error).message}`);
    }
  }

  // 3. refunds owed — failed batches and organizer "Refund everyone"
  // requests (idempotent; retries anything a crashed run left behind)
  const { data: owing } = await supabase.rpc("list_funding_requests_owing_refunds");
  for (const fundingRequestId of (owing ?? []) as string[]) {
    try {
      summary.refundsRequested += await refundOwedContributions(supabase, fundingRequestId);
    } catch (err) {
      summary.errors.push(`refund ${fundingRequestId}: ${(err as Error).message}`);
    }
  }

  return summary;
}

async function getBatch(supabase: ServiceClient, fundingRequestId: string): Promise<BatchMandate[]> {
  const { data, error } = await supabase.rpc("get_funding_charge_batch", {
    p_funding_request_id: fundingRequestId,
  });
  if (error) throw new Error(`get_funding_charge_batch: ${error.message}`);
  return (data ?? []) as BatchMandate[];
}

async function fireBatch(
  supabase: ServiceClient,
  fundingRequestId: string,
): Promise<{ fired: number; failed: boolean }> {
  let fired = 0;
  const initial = await getBatch(supabase, fundingRequestId);

  for (const { mandate_id } of initial) {
    // Re-read before every fire: a webhook may have failed the batch
    // mid-loop, which cancels every not-yet-fired mandate.
    const m = (await getBatch(supabase, fundingRequestId)).find((b) => b.mandate_id === mandate_id);
    if (!m || m.status !== "charging") continue;

    if (m.stripe_payment_intent_id) {
      if (Date.now() - new Date(m.updated_at).getTime() > STALE_INTENT_MS) {
        await reconcilePaymentIntent(supabase, m.stripe_payment_intent_id);
      }
      continue;
    }

    const result = await fireMandate(supabase, fundingRequestId, m);
    fired++;
    if (result === "failed") {
      await refundOwedContributions(supabase, fundingRequestId);
      return { fired, failed: true };
    }
    if (result === "error") {
      // Unknown outcome (network/API error). Leave it 'charging' with no
      // intent recorded; the next run retries with the SAME idempotency key,
      // which returns the original intent instead of charging twice.
      return { fired, failed: false };
    }
  }
  return { fired, failed: false };
}

async function fireMandate(
  supabase: ServiceClient,
  fundingRequestId: string,
  m: BatchMandate,
): Promise<"ok" | "failed" | "error"> {
  const stripe = getStripe();
  if (!m.stripe_customer_id || !m.stripe_payment_method_id || !m.payment_method_type) {
    await supabase.rpc("mark_mandate_charge_failed", {
      p_mandate_id: m.mandate_id,
      p_reason: "mandate has no saved payment method",
    });
    return "failed";
  }

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: toMinorUnits(Number(m.individual_amount), m.currency),
        currency: m.currency.toLowerCase(),
        customer: m.stripe_customer_id,
        payment_method: m.stripe_payment_method_id,
        payment_method_types: [m.payment_method_type],
        off_session: true,
        confirm: true,
        description: "Catoco trip funding — your share",
        metadata: {
          funding_request_id: fundingRequestId,
          mandate_id: m.mandate_id,
          participant_id: m.participant_id,
        },
      },
      { idempotencyKey: `catoco-mandate-charge-${m.mandate_id}` },
    );
    await supabase.rpc("set_mandate_payment_intent", {
      p_mandate_id: m.mandate_id,
      p_payment_intent_id: pi.id,
    });

    // succeeded -> webhook records it; processing (SEPA) -> webhook later.
    if (pi.status === "succeeded" || pi.status === "processing") return "ok";

    // requires_action = SCA the customer isn't here to complete. Anything
    // else non-terminal is equally un-completable off-session.
    await stripe.paymentIntents.cancel(pi.id).catch(() => undefined);
    await supabase.rpc("mark_mandate_charge_failed", {
      p_mandate_id: m.mandate_id,
      p_reason: pi.status === "requires_action" ? "authentication_required" : `payment_intent ${pi.status}`,
    });
    return "failed";
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      const piId = err.payment_intent?.id;
      if (piId) {
        await supabase.rpc("set_mandate_payment_intent", { p_mandate_id: m.mandate_id, p_payment_intent_id: piId });
      }
      await supabase.rpc("mark_mandate_charge_failed", {
        p_mandate_id: m.mandate_id,
        p_reason: err.decline_code ?? err.code ?? err.message,
      });
      return "failed";
    }
    console.error(`[funding-charges] mandate ${m.mandate_id} charge errored`, err);
    return "error";
  }
}

/** Refunds every not-yet-refunded succeeded Stripe charge owed back on a
 * request — a failed batch, or an organizer's "Refund everyone". Returns
 * the number of refunds requested. The ledger flips to refunded only when
 * charge.refunded arrives (webhook), not here. */
export async function refundOwedContributions(supabase: ServiceClient, fundingRequestId: string): Promise<number> {
  const stripe = getStripe();
  const { data, error } = await supabase.rpc("list_refundable_contributions", {
    p_funding_request_id: fundingRequestId,
  });
  if (error) throw new Error(`list_refundable_contributions: ${error.message}`);
  let count = 0;
  for (const row of (data ?? []) as { stripe_payment_intent_id: string }[]) {
    const refund = await stripe.refunds.create(
      {
        payment_intent: row.stripe_payment_intent_id,
        metadata: { funding_request_id: fundingRequestId, reason: "catoco_funding_refund" },
      },
      { idempotencyKey: `catoco-batch-refund-${row.stripe_payment_intent_id}` },
    );
    await supabase.rpc("mark_contribution_refund_requested", {
      p_payment_intent_id: row.stripe_payment_intent_id,
      p_refund_id: refund.id,
    });
    count++;
  }
  return count;
}

// ---- event handlers (webhook + reconcile share these) ----------------------

export async function handlePaymentIntentSucceeded(supabase: ServiceClient, pi: Stripe.PaymentIntent) {
  const mandateId = pi.metadata?.mandate_id;
  if (!mandateId) return; // not one of ours

  // The real fee lives on the charge's balance transaction.
  const full = await getStripe().paymentIntents.retrieve(pi.id, {
    expand: ["latest_charge.balance_transaction"],
  });
  const charge = typeof full.latest_charge === "object" ? full.latest_charge : null;
  const bt =
    charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;

  const { data: chargeStatus, error } = await supabase.rpc("record_stripe_contribution", {
    p_mandate_id: mandateId,
    p_payment_intent_id: full.id,
    p_charge_id: charge?.id ?? null,
    p_amount: fromMinorUnits(full.amount_received, full.currency),
    p_fee: bt ? fromMinorUnits(bt.fee, bt.currency) : null,
    p_fee_currency: bt?.currency ?? null,
  });
  if (error) throw new Error(`record_stripe_contribution: ${error.message}`);

  // A charge that lands after its batch already failed (or after the
  // organizer refunded the pool) is refunded now; a no-op otherwise.
  if (chargeStatus !== "charged" && pi.metadata.funding_request_id) {
    await refundOwedContributions(supabase, pi.metadata.funding_request_id);
  }
}

export async function handlePaymentIntentFailed(supabase: ServiceClient, pi: Stripe.PaymentIntent) {
  const mandateId = pi.metadata?.mandate_id;
  if (!mandateId) return;
  const reason =
    pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? pi.last_payment_error?.message ?? "payment_failed";
  const { data: fundingRequestId, error } = await supabase.rpc("mark_mandate_charge_failed", {
    p_mandate_id: mandateId,
    p_reason: reason,
  });
  if (error) throw new Error(`mark_mandate_charge_failed: ${error.message}`);
  if (fundingRequestId) await refundOwedContributions(supabase, fundingRequestId as string);
}

async function reconcilePaymentIntent(supabase: ServiceClient, paymentIntentId: string) {
  const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
  if (pi.status === "succeeded") {
    await handlePaymentIntentSucceeded(supabase, pi);
  } else if (pi.status === "requires_payment_method" || pi.status === "canceled") {
    await handlePaymentIntentFailed(supabase, pi);
  }
}
