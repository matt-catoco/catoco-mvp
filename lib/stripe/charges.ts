import "server-only";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { fromMinorUnits, getStripe, toMinorUnits } from "@/lib/stripe/server";
import { requoteOption } from "@/lib/vendor-search/requote";
import { notifyPaymentRetryNeeded } from "@/lib/notifications";

/**
 * The charge engine for mandate-based funding (flow #4): AUTHORIZE, then
 * CAPTURE (20261008000000_authorize_then_capture.sql). Shared by the
 * deadline cron, the Stripe webhook, and the participant's retry actions.
 * All DB writes go through service-role-only security-definer RPCs.
 *
 * One funding_request at its deadline:
 *   1. begin_funding_charge_batch claims it ('charging'). Not fully mandated
 *      → failed right there, nothing touched.
 *   2. Holds: one off-session card PaymentIntent per mandate with
 *      capture_method 'manual'. Success = requires_capture ('held'): funds
 *      reserved, nothing charged, no fee. A failed hold does NOT fail the
 *      pool — the mandate goes to 'awaiting_retry' (new payment method, or
 *      on-session authentication) until funding_requests.retry_deadline,
 *      and the participant + organizer are emailed. Everyone else's hold
 *      just waits.
 *   3. Capture: once every card hold is in (begin_funding_capture), capture
 *      them all and only now confirm SEPA debits (SEPA has no hold). This
 *      is the one moment money moves and fees are incurred.
 *   4. Retry window expires → every other hold is CANCELED (released), the
 *      request fails. Nothing was captured, so nothing is refunded.
 *   5. The only refund path left: a settlement failure (a SEPA debit or a
 *      capture failing after money moved) refunds what was captured.
 *
 * Every Stripe write carries an idempotency key derived from our own ids,
 * so a crashed/retried run can't double-hold, double-capture or double-
 * refund. A contribution row is only written from a SUCCEEDED (= captured
 * or settled) PaymentIntent — never from a hold.
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
  retry_reason: string | null;
  hold_attempt: number;
};

// A PaymentIntent with no recorded outcome this long gets looked up
// directly — covers a missed webhook without racing the normal path.
const STALE_INTENT_MS = 60 * 60 * 1000;

export type ChargeJobSummary = {
  claimed: { fundingRequestId: string; outcome: string | null }[];
  holdsPlaced: number;
  awaitingRetry: number;
  captured: string[];
  expired: string[];
  failedBatches: string[];
  refundsRequested: number;
  errors: string[];
  /** Price cushion: vendor options re-quoted right before charging. */
  repriced: { elementId: string; outcome: string }[];
};

// Re-quote vendor-priced options whose deadline is within this window, so
// the hold reflects the price at charge time (price cushion).
const RECHECK_WINDOW_HOURS = 2;

export async function runFundingChargeJob(origin: string): Promise<ChargeJobSummary> {
  const supabase = createServiceClient();
  const summary: ChargeJobSummary = {
    claimed: [], holdsPlaced: 0, awaitingRetry: 0, captured: [], expired: [],
    failedBatches: [], refundsRequested: 0, errors: [], repriced: [],
  };

  // 0. recheck vendor prices (Duffel / LiteAPI) right before charging.
  const { data: dueForRecheck } = await supabase.rpc("list_vendor_priced_elements_due", {
    p_hours: RECHECK_WINDOW_HOURS,
  });
  for (const row of (dueForRecheck ?? []) as { element_id: string; value: Record<string, unknown> }[]) {
    try {
      const quote = await requoteOption(row.value);
      const currency = String(row.value.currency ?? "").toUpperCase();
      if (!quote.ok || (currency && quote.currency.toUpperCase() !== currency)) continue;
      const { data: outcome, error } = await supabase.rpc("reprice_locked_element", {
        p_element_id: row.element_id,
        p_unit_price: Math.round(quote.unitPrice * 100) / 100,
      });
      if (error) summary.errors.push(`reprice ${row.element_id}: ${error.message}`);
      else summary.repriced.push({ elementId: row.element_id, outcome: outcome as string });
    } catch (err) {
      summary.errors.push(`requote ${row.element_id}: ${(err as Error).message}`);
    }
  }

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

  // 2. advance every batch in its holds phase (place holds, expire retry
  // windows, capture when everyone's in) — includes batches earlier runs
  // started.
  const { data: charging } = await supabase.rpc("list_funding_requests_by_charge_status", {
    p_charge_status: "charging",
  });
  for (const fundingRequestId of (charging ?? []) as string[]) {
    try {
      const res = await advanceBatch(supabase, fundingRequestId, origin);
      summary.holdsPlaced += res.holdsPlaced;
      summary.awaitingRetry += res.awaitingRetry;
      if (res.outcome === "captured") summary.captured.push(fundingRequestId);
      if (res.outcome === "expired") summary.expired.push(fundingRequestId);
      if (res.outcome === "failed") summary.failedBatches.push(fundingRequestId);
    } catch (err) {
      summary.errors.push(`advance ${fundingRequestId}: ${(err as Error).message}`);
    }
  }

  // 3. capturing batches: reconcile anything still in flight (SEPA debits
  // settle by webhook; this covers a missed one).
  const { data: capturing } = await supabase.rpc("list_funding_requests_by_charge_status", {
    p_charge_status: "capturing",
  });
  for (const fundingRequestId of (capturing ?? []) as string[]) {
    try {
      await captureBatch(supabase, fundingRequestId);
    } catch (err) {
      summary.errors.push(`capture ${fundingRequestId}: ${(err as Error).message}`);
    }
  }

  // 4. refunds owed — settlement failures and organizer "Refund everyone"
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

/**
 * Moves one 'charging' batch forward as far as it can right now: expire an
 * elapsed retry window, place any missing card holds, and capture once
 * every hold is in. Safe to call any time (job, webhook, retry actions).
 */
export async function advanceBatch(
  supabase: ServiceClient,
  fundingRequestId: string,
  origin: string,
): Promise<{ holdsPlaced: number; awaitingRetry: number; outcome: "waiting" | "captured" | "expired" | "failed" }> {
  // Retry window (or the hold-lifetime safety cap) elapsed → release holds.
  const { data: toCancel, error: expireError } = await supabase.rpc("expire_funding_retry", {
    p_funding_request_id: fundingRequestId,
  });
  if (expireError) throw new Error(`expire_funding_retry: ${expireError.message}`);
  if (Array.isArray(toCancel) && toCancel.length > 0) {
    await cancelIntents(toCancel as string[]);
    return { holdsPlaced: 0, awaitingRetry: 0, outcome: "expired" };
  }

  let holdsPlaced = 0;
  let awaitingRetry = 0;
  for (const m of await getBatch(supabase, fundingRequestId)) {
    if (m.status !== "charging" || m.payment_method_type !== "card") continue;
    if (m.stripe_payment_intent_id) {
      // Outcome never recorded (crash between create and write) — ask Stripe.
      if (Date.now() - new Date(m.updated_at).getTime() > STALE_INTENT_MS) {
        const pi = await getStripe().paymentIntents.retrieve(m.stripe_payment_intent_id);
        await applyHoldOutcome(supabase, m, pi, origin);
      }
      continue;
    }
    const outcome = await placeHold(supabase, fundingRequestId, m, origin);
    if (outcome === "held") holdsPlaced++;
    if (outcome === "awaiting_retry") awaitingRetry++;
    if (outcome === "error") return { holdsPlaced, awaitingRetry, outcome: "waiting" }; // retry next pass
  }

  const { data: ready, error: readyError } = await supabase.rpc("begin_funding_capture", {
    p_funding_request_id: fundingRequestId,
  });
  if (readyError) throw new Error(`begin_funding_capture: ${readyError.message}`);
  if (!ready) return { holdsPlaced, awaitingRetry, outcome: "waiting" };

  const failed = await captureBatch(supabase, fundingRequestId);
  return { holdsPlaced, awaitingRetry, outcome: failed ? "failed" : "captured" };
}

/** Off-session authorization HOLD on a saved card. Nothing is charged. */
async function placeHold(
  supabase: ServiceClient,
  fundingRequestId: string,
  m: BatchMandate,
  origin: string,
): Promise<"held" | "awaiting_retry" | "error"> {
  if (!m.stripe_customer_id || !m.stripe_payment_method_id) {
    await toAwaitingRetry(supabase, m.mandate_id, null, "payment_method_failed", "no saved payment method", origin);
    return "awaiting_retry";
  }
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: toMinorUnits(Number(m.individual_amount), m.currency),
        currency: m.currency.toLowerCase(),
        customer: m.stripe_customer_id,
        payment_method: m.stripe_payment_method_id,
        payment_method_types: ["card"],
        capture_method: "manual",
        off_session: true,
        confirm: true,
        description: "Catoco trip funding — your share (hold)",
        metadata: { funding_request_id: fundingRequestId, mandate_id: m.mandate_id, participant_id: m.participant_id },
      },
      { idempotencyKey: `catoco-mandate-hold-${m.mandate_id}-${m.hold_attempt}` },
    );
    await supabase.rpc("set_mandate_payment_intent", { p_mandate_id: m.mandate_id, p_payment_intent_id: pi.id });
    return applyHoldOutcome(supabase, m, pi, origin);
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      const piId = err.payment_intent?.id ?? null;
      const reason = err.code === "authentication_required" ? "authentication_required" : "payment_method_failed";
      await toAwaitingRetry(supabase, m.mandate_id, piId, reason, err.decline_code ?? err.code ?? err.message, origin);
      return "awaiting_retry";
    }
    console.error(`[funding-charges] hold for mandate ${m.mandate_id} errored`, err);
    return "error";
  }
}

async function applyHoldOutcome(
  supabase: ServiceClient,
  m: Pick<BatchMandate, "mandate_id">,
  pi: Stripe.PaymentIntent,
  origin: string,
): Promise<"held" | "awaiting_retry" | "error"> {
  if (pi.status === "requires_capture") {
    await supabase.rpc("mark_mandate_held", { p_mandate_id: m.mandate_id, p_payment_intent_id: pi.id });
    return "held";
  }
  if (pi.status === "requires_action" || pi.last_payment_error?.code === "authentication_required") {
    await toAwaitingRetry(supabase, m.mandate_id, pi.id, "authentication_required", "bank requires authentication", origin);
    return "awaiting_retry";
  }
  if (pi.status === "requires_payment_method" || pi.status === "canceled") {
    const e = pi.last_payment_error;
    await toAwaitingRetry(supabase, m.mandate_id, pi.id, "payment_method_failed", e?.decline_code ?? e?.code ?? "declined", origin);
    return "awaiting_retry";
  }
  return "error"; // processing / requires_confirmation — look again next pass
}

async function toAwaitingRetry(
  supabase: ServiceClient,
  mandateId: string,
  paymentIntentId: string | null,
  reason: "payment_method_failed" | "authentication_required",
  detail: string,
  origin: string,
) {
  const { data, error } = await supabase.rpc("mark_mandate_awaiting_retry", {
    p_mandate_id: mandateId,
    p_payment_intent_id: paymentIntentId,
    p_reason: reason,
    p_detail: detail,
  });
  if (error) throw new Error(`mark_mandate_awaiting_retry: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { funding_request_id: string; newly_awaiting: boolean; retry_deadline: string | null }
    | undefined;
  if (row?.newly_awaiting) {
    await notifyPaymentRetryNeeded({ supabase, mandateId, reason, retryDeadline: row.retry_deadline, origin });
  }
}

/**
 * The capture pass: capture every card hold, then confirm SEPA debits.
 * Idempotent (re-run safely by the job while 'capturing'). Returns true if
 * a settlement failure failed the batch.
 */
async function captureBatch(supabase: ServiceClient, fundingRequestId: string): Promise<boolean> {
  const stripe = getStripe();
  const batch = await getBatch(supabase, fundingRequestId);

  for (const m of batch.filter((b) => b.status === "held" && b.stripe_payment_intent_id)) {
    try {
      const pi = await stripe.paymentIntents.capture(
        m.stripe_payment_intent_id!,
        {},
        { idempotencyKey: `catoco-mandate-capture-${m.stripe_payment_intent_id}` },
      );
      if (pi.status === "succeeded") await handlePaymentIntentSucceeded(supabase, pi);
    } catch (err) {
      // Already captured (a retried pass) → just record it.
      const existing = await stripe.paymentIntents.retrieve(m.stripe_payment_intent_id!).catch(() => null);
      if (existing?.status === "succeeded") {
        await handlePaymentIntentSucceeded(supabase, existing);
        continue;
      }
      await settlementFailure(supabase, fundingRequestId, m.mandate_id, `capture failed: ${(err as Error).message}`);
      return true;
    }
  }

  for (const m of batch.filter((b) => b.payment_method_type === "sepa_debit" && b.status === "charging")) {
    if (m.stripe_payment_intent_id) {
      if (Date.now() - new Date(m.updated_at).getTime() > STALE_INTENT_MS) {
        const pi = await stripe.paymentIntents.retrieve(m.stripe_payment_intent_id);
        if (pi.status === "succeeded") await handlePaymentIntentSucceeded(supabase, pi);
        else if (pi.status === "requires_payment_method" || pi.status === "canceled") {
          await settlementFailure(supabase, fundingRequestId, m.mandate_id, "SEPA debit failed");
          return true;
        }
      }
      continue;
    }
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: toMinorUnits(Number(m.individual_amount), m.currency),
          currency: m.currency.toLowerCase(),
          customer: m.stripe_customer_id!,
          payment_method: m.stripe_payment_method_id!,
          payment_method_types: ["sepa_debit"],
          off_session: true,
          confirm: true,
          description: "Catoco trip funding — your share",
          metadata: { funding_request_id: fundingRequestId, mandate_id: m.mandate_id, participant_id: m.participant_id },
        },
        { idempotencyKey: `catoco-mandate-sepa-${m.mandate_id}-${m.hold_attempt}` },
      );
      await supabase.rpc("set_mandate_payment_intent", { p_mandate_id: m.mandate_id, p_payment_intent_id: pi.id });
      if (pi.status === "succeeded") await handlePaymentIntentSucceeded(supabase, pi);
      else if (pi.status !== "processing") {
        await settlementFailure(supabase, fundingRequestId, m.mandate_id, `SEPA debit ${pi.status}`);
        return true;
      }
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError || err instanceof Stripe.errors.StripeInvalidRequestError) {
        await settlementFailure(supabase, fundingRequestId, m.mandate_id, `SEPA debit failed: ${err.message}`);
        return true;
      }
      console.error(`[funding-charges] SEPA debit for mandate ${m.mandate_id} errored`, err);
      return false; // unknown — the next pass retries with the same idempotency key
    }
  }
  return false;
}

/**
 * The one remaining refund path: money already moved in this batch and a
 * later step failed (a SEPA debit, or a capture). Fail the batch, release
 * any holds not yet captured, refund whatever was captured/settled.
 */
async function settlementFailure(supabase: ServiceClient, fundingRequestId: string, mandateId: string, reason: string) {
  const openHolds = (await getBatch(supabase, fundingRequestId))
    .filter((b) => b.status === "held" && b.stripe_payment_intent_id)
    .map((b) => b.stripe_payment_intent_id!);
  const { error } = await supabase.rpc("mark_mandate_charge_failed", { p_mandate_id: mandateId, p_reason: reason });
  if (error) throw new Error(`mark_mandate_charge_failed: ${error.message}`);
  await cancelIntents(openHolds);
  await refundOwedContributions(supabase, fundingRequestId);
}

async function cancelIntents(ids: string[]) {
  const stripe = getStripe();
  for (const id of ids) {
    await stripe.paymentIntents
      .cancel(id, {}, { idempotencyKey: `catoco-release-${id}` })
      .catch((err) => {
        // Already canceled/captured or expired on its own — nothing held.
        console.error(`[funding-charges] cancel ${id}:`, (err as Error).message);
      });
  }
}

/** Refunds every not-yet-refunded succeeded Stripe charge owed back on a
 * request — a settlement failure, or an organizer's "Refund everyone". The
 * ledger flips to refunded only when charge.refunded arrives. */
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

// ---- event handlers (webhook, capture pass, reconcile) ---------------------

/** A captured card hold or a settled SEPA debit — real money. */
export async function handlePaymentIntentSucceeded(supabase: ServiceClient, pi: Stripe.PaymentIntent) {
  const mandateId = pi.metadata?.mandate_id;
  if (!mandateId) return; // not one of ours

  const full = await getStripe().paymentIntents.retrieve(pi.id, { expand: ["latest_charge.balance_transaction"] });
  const charge = typeof full.latest_charge === "object" ? full.latest_charge : null;
  const bt = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;

  const { data: chargeStatus, error } = await supabase.rpc("record_stripe_contribution", {
    p_mandate_id: mandateId,
    p_payment_intent_id: full.id,
    p_charge_id: charge?.id ?? null,
    p_amount: fromMinorUnits(full.amount_received, full.currency),
    p_fee: bt ? fromMinorUnits(bt.fee, bt.currency) : null,
    p_fee_currency: bt?.currency ?? null,
  });
  if (error) throw new Error(`record_stripe_contribution: ${error.message}`);

  // Money that lands after its batch already failed (or after the organizer
  // refunded the pool) goes straight back; a no-op otherwise.
  if (chargeStatus === "failed" && pi.metadata.funding_request_id) {
    await refundOwedContributions(supabase, pi.metadata.funding_request_id);
  }
}

/** payment_intent.amount_capturable_updated: an async hold landed. */
export async function handleHoldPlaced(supabase: ServiceClient, pi: Stripe.PaymentIntent, origin: string) {
  const mandateId = pi.metadata?.mandate_id;
  if (!mandateId || pi.status !== "requires_capture") return;
  const { data: fundingRequestId } = await supabase.rpc("mark_mandate_held", {
    p_mandate_id: mandateId,
    p_payment_intent_id: pi.id,
  });
  if (fundingRequestId) await advanceBatch(supabase, fundingRequestId as string, origin);
}

/** payment_intent.requires_action: a hold needs the cardholder on-session. */
export async function handleRequiresAction(supabase: ServiceClient, pi: Stripe.PaymentIntent, origin: string) {
  const mandateId = pi.metadata?.mandate_id;
  if (!mandateId || pi.capture_method !== "manual") return;
  await toAwaitingRetry(supabase, mandateId, pi.id, "authentication_required", "bank requires authentication", origin);
}

/** payment_intent.payment_failed: a card hold → retry window; a SEPA debit
 * (or anything automatic-capture) → settlement failure. */
export async function handlePaymentIntentFailed(supabase: ServiceClient, pi: Stripe.PaymentIntent, origin: string) {
  const mandateId = pi.metadata?.mandate_id;
  if (!mandateId) return;
  const e = pi.last_payment_error;
  if (pi.capture_method === "manual") {
    const reason = e?.code === "authentication_required" ? "authentication_required" : "payment_method_failed";
    await toAwaitingRetry(supabase, mandateId, pi.id, reason, e?.decline_code ?? e?.code ?? "declined", origin);
    return;
  }
  const fundingRequestId = pi.metadata.funding_request_id;
  if (fundingRequestId) {
    await settlementFailure(supabase, fundingRequestId, mandateId, e?.decline_code ?? e?.code ?? e?.message ?? "payment_failed");
  }
}

/** payment_intent.canceled: ours (release after expiry / settlement
 * failure) is already reflected in the DB — no-op. A hold Stripe expired
 * on its own while the batch still waits goes back for a fresh hold. */
export async function handlePaymentIntentCanceled(supabase: ServiceClient, pi: Stripe.PaymentIntent) {
  const mandateId = pi.metadata?.mandate_id;
  if (!mandateId || pi.capture_method !== "manual" || pi.cancellation_reason !== "automatic") return;
  await supabase.rpc("reset_mandate_for_new_hold", {
    p_mandate_id: mandateId,
    p_payment_method_id: null,
    p_payment_method_type: null,
    p_setup_intent_id: null,
  });
}

/** Participant retry: after they've added a new payment method or
 * authenticated on-session, re-read the truth from Stripe and move on. */
export async function syncRetriedHold(
  supabase: ServiceClient,
  mandateId: string,
  fundingRequestId: string,
  paymentIntentId: string,
  origin: string,
) {
  const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
  const outcome = await applyHoldOutcome(supabase, { mandate_id: mandateId }, pi, origin);
  if (outcome === "held") await advanceBatch(supabase, fundingRequestId, origin);
  return outcome;
}
