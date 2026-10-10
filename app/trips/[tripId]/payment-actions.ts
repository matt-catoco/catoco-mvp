"use server";

import { revalidatePath } from "next/cache";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { travelerDetailsOwed } from "@/lib/traveler-details";
import { toUserFacingError } from "@/lib/action-errors";
import { getStripe, stripeConfigured } from "@/lib/stripe/server";
import { activateFromSetupIntent, getOrCreateStripeCustomer } from "@/lib/stripe/mandates";
import { headers } from "next/headers";
import { advanceBatch, refundOwedContributions, syncRetriedHold } from "@/lib/stripe/charges";

/**
 * Mandate-based funding (flow #4, Stripe TEST MODE). A participant
 * authorizes their fixed share now via a SetupIntent + the Payment Element;
 * nothing is charged until the funding_deadline cron. Authority checks live
 * in the security-definer RPCs (create_funding_mandate / cancel_funding_
 * mandate) called with the user's own session — the service client is only
 * used for the Stripe-side bookkeeping those RPCs deliberately don't expose
 * to a signed-in user (customer mapping, attaching the SetupIntent).
 */

function revalidateFunding(tripId: string, elementId: string) {
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
}

export type StartMandateResult = {
  error?: string;
  mandateId?: string;
  clientSecret?: string;
  paymentMethodTypes?: string[];
  /** SEPA was wanted (EUR trip) but the Stripe account doesn't have it
   * enabled — the form fell back to card only. */
  sepaUnavailable?: boolean;
};

export async function startFundingMandate(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
): Promise<StartMandateResult> {
  if (!stripeConfigured()) {
    return { error: "Payments aren't set up in this environment yet." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  // Traveler details are collected at the commit step (only what the element needs).
  const owed = await travelerDetailsOwed(createServiceClient(), fundingRequestId, user.id);
  if (owed.length) return { error: `Add your traveler details for ${owed.join(", ")} first.` };

  const { data: mandateId, error } = await supabase.rpc("create_funding_mandate", {
    p_funding_request_id: fundingRequestId,
  });
  if (error) return { error: toUserFacingError(error) };

  const { data: mandate } = await supabase
    .from("funding_mandates")
    .select("id, currency")
    .eq("id", mandateId as string)
    .maybeSingle();
  if (!mandate) return { error: toUserFacingError({ message: "mandate vanished after create" }) };

  try {
    const service = createServiceClient();
    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(service, user.id, user.email);

    // SEPA settles only in EUR, so it's offered only on EUR requests (and
    // listed first — it's the cheaper default there).
    const wantsSepa = mandate.currency === "EUR";
    const metadata = { mandate_id: mandate.id, funding_request_id: fundingRequestId, user_id: user.id };
    let setupIntent: Stripe.SetupIntent;
    let sepaUnavailable = false;
    try {
      setupIntent = await stripe.setupIntents.create(
        {
          customer: customerId,
          usage: "off_session",
          payment_method_types: wantsSepa ? ["sepa_debit", "card"] : ["card"],
          metadata,
        },
        { idempotencyKey: `catoco-mandate-setup-${mandate.id}` },
      );
    } catch (err) {
      // SEPA not activated on the account (sandbox default) — degrade to
      // card rather than blocking the participant entirely.
      if (!wantsSepa || !(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
      console.error("[startFundingMandate] sepa_debit unavailable, falling back to card:", err.message);
      sepaUnavailable = true;
      setupIntent = await stripe.setupIntents.create(
        { customer: customerId, usage: "off_session", payment_method_types: ["card"], metadata },
        { idempotencyKey: `catoco-mandate-setup-${mandate.id}-card` },
      );
    }

    const { error: attachError } = await service.rpc("attach_mandate_setup_intent", {
      p_mandate_id: mandate.id,
      p_stripe_customer_id: customerId,
      p_setup_intent_id: setupIntent.id,
    });
    if (attachError) return { error: toUserFacingError(attachError) };

    return {
      mandateId: mandate.id,
      clientSecret: setupIntent.client_secret ?? undefined,
      paymentMethodTypes: setupIntent.payment_method_types,
      sepaUnavailable,
    };
  } catch (err) {
    return { error: toUserFacingError({ message: (err as Error).message }) };
  }
}

export type SyncMandateResult = { error?: string; status?: string };

/**
 * Called right after stripe.confirmSetup() resolves client-side, so the
 * card flips to "authorized" without waiting on the webhook (which does the
 * same thing idempotently). Re-reads the SetupIntent from Stripe — never
 * trusts the browser's word that it succeeded.
 */
export async function syncFundingMandate(
  tripId: string,
  elementId: string,
  mandateId: string,
): Promise<SyncMandateResult> {
  const supabase = await createClient();
  // RLS: only the participant's own mandate is readable here.
  const { data: mandate } = await supabase
    .from("funding_mandates")
    .select("id, status, stripe_setup_intent_id")
    .eq("id", mandateId)
    .maybeSingle();
  if (!mandate?.stripe_setup_intent_id) return { error: "Authorization not found." };

  try {
    const si = await getStripe().setupIntents.retrieve(mandate.stripe_setup_intent_id);
    if (si.status === "succeeded") {
      await activateFromSetupIntent(createServiceClient(), si);
    }
    revalidateFunding(tripId, elementId);
    return { status: si.status };
  } catch (err) {
    return { error: toUserFacingError({ message: (err as Error).message }) };
  }
}

export type CancelMandateResult = { error?: string };

/** Participant withdraws before the deadline batch starts. Detaching the
 * payment method also invalidates a SEPA mandate on Stripe's side. */
export async function cancelFundingMandate(
  tripId: string,
  elementId: string,
  mandateId: string,
): Promise<CancelMandateResult> {
  const supabase = await createClient();
  const { data: paymentMethodId, error } = await supabase.rpc("cancel_funding_mandate", {
    p_mandate_id: mandateId,
  });
  if (error) return { error: toUserFacingError(error) };

  if (paymentMethodId && stripeConfigured()) {
    await getStripe()
      .paymentMethods.detach(paymentMethodId as string)
      .catch((err) => console.error("[cancelFundingMandate] detach failed", err));
  }
  revalidateFunding(tripId, elementId);
  return {};
}

export type RefundEveryoneResult = { error?: string; refundsRequested?: number };

/**
 * Organizer/co-organizer: return every succeeded Stripe charge on a
 * funding request to its payer (cancelling a funded element or trip).
 * request_funding_refund_all() does the authority check and flags the
 * request; the refunds are issued here right away (the cron retries any
 * that don't go out), and charge.refunded webhooks settle the ledger —
 * the request shows Refunded once the last one lands.
 */
export async function refundEveryone(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
): Promise<RefundEveryoneResult> {
  if (!stripeConfigured()) {
    return { error: "Payments aren't set up in this environment yet." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_funding_refund_all", {
    p_funding_request_id: fundingRequestId,
  });
  if (error) return { error: toUserFacingError(error) };

  try {
    const refundsRequested = await refundOwedContributions(createServiceClient(), fundingRequestId);
    revalidateFunding(tripId, elementId);
    revalidatePath(`/trips/${tripId}/settings`);
    return { refundsRequested };
  } catch (err) {
    // The request is flagged; the next cron pass retries the refunds.
    revalidateFunding(tripId, elementId);
    return { error: toUserFacingError({ message: (err as Error).message }) };
  }
}

// ---- retry buffer (authorize-then-capture) ---------------------------------

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  return host ? `${proto}://${host}` : "https://www.catoco.co";
}

type OwnRetryMandate = {
  id: string;
  status: string;
  retry_reason: string | null;
  currency: string;
  funding_request_id: string;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_payment_method_id: string | null;
  hold_attempt: number;
};

/** The caller's OWN mandate (RLS), only while it's waiting on them. */
async function loadOwnRetryMandate(mandateId: string): Promise<OwnRetryMandate | { error: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("funding_mandates")
    .select("id, status, retry_reason, currency, funding_request_id, stripe_customer_id, stripe_payment_intent_id, stripe_payment_method_id, hold_attempt, participant_id")
    .eq("id", mandateId)
    .maybeSingle();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!data || !user || data.participant_id !== user.id) return { error: "Payment not found." };
  if (data.status !== "awaiting_retry") return { error: "This payment isn't waiting on you anymore." };
  return data as OwnRetryMandate;
}

export type RetrySetupResult = { error?: string; clientSecret?: string; paymentMethodTypes?: string[] };

/** Declined / expired card: collect a NEW payment method (fresh SetupIntent). */
export async function startRetryPaymentMethod(tripId: string, elementId: string, mandateId: string): Promise<RetrySetupResult> {
  if (!stripeConfigured()) return { error: "Payments aren't set up in this environment yet." };
  const m = await loadOwnRetryMandate(mandateId);
  if ("error" in m) return m;
  if (m.retry_reason !== "payment_method_failed" || !m.stripe_customer_id) {
    return { error: "This payment needs you to confirm it with your bank instead." };
  }
  try {
    const si = await getStripe().setupIntents.create(
      {
        customer: m.stripe_customer_id,
        usage: "off_session",
        payment_method_types: m.currency === "EUR" ? ["card", "sepa_debit"] : ["card"],
        metadata: { mandate_id: m.id, funding_request_id: m.funding_request_id, purpose: "retry" },
      },
      { idempotencyKey: `catoco-mandate-retry-setup-${m.id}-${m.hold_attempt}` },
    ).catch(async (err) => {
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError) || m.currency !== "EUR") throw err;
      return getStripe().setupIntents.create(
        { customer: m.stripe_customer_id!, usage: "off_session", payment_method_types: ["card"], metadata: { mandate_id: m.id, funding_request_id: m.funding_request_id, purpose: "retry" } },
        { idempotencyKey: `catoco-mandate-retry-setup-${m.id}-${m.hold_attempt}-card` },
      );
    });
    revalidateFunding(tripId, elementId);
    return { clientSecret: si.client_secret ?? undefined, paymentMethodTypes: si.payment_method_types };
  } catch (err) {
    return { error: toUserFacingError({ message: (err as Error).message }) };
  }
}

/** After confirmSetup(): swap in the new method and place a fresh hold. */
export async function completeRetryPaymentMethod(
  tripId: string,
  elementId: string,
  mandateId: string,
  setupIntentId: string,
): Promise<{ error?: string; outcome?: string }> {
  const m = await loadOwnRetryMandate(mandateId);
  if ("error" in m) return m;
  try {
    const stripe = getStripe();
    const si = await stripe.setupIntents.retrieve(setupIntentId);
    if (si.metadata?.mandate_id !== m.id) return { error: "That payment method doesn't belong to this payment." };
    if (si.status !== "succeeded" || !si.payment_method) return { error: "The new payment method wasn't confirmed." };
    const pm = typeof si.payment_method === "string" ? await stripe.paymentMethods.retrieve(si.payment_method) : si.payment_method;
    const service = createServiceClient();
    const { data: frId, error } = await service.rpc("reset_mandate_for_new_hold", {
      p_mandate_id: m.id,
      p_payment_method_id: pm.id,
      p_payment_method_type: pm.type,
      p_setup_intent_id: si.id,
    });
    if (error) return { error: toUserFacingError(error) };
    if (!frId) return { error: "This payment isn't waiting on you anymore." };
    const res = await advanceBatch(service, frId as string, await requestOrigin());
    revalidateFunding(tripId, elementId);
    return { outcome: res.outcome };
  } catch (err) {
    return { error: toUserFacingError({ message: (err as Error).message }) };
  }
}

/** Bank wants SCA: hand the client the SAME PaymentIntent to authenticate on-session. */
export async function getRetryAuthentication(
  tripId: string,
  elementId: string,
  mandateId: string,
): Promise<{ error?: string; clientSecret?: string; paymentMethodId?: string }> {
  const m = await loadOwnRetryMandate(mandateId);
  if ("error" in m) return m;
  if (m.retry_reason !== "authentication_required" || !m.stripe_payment_intent_id) {
    return { error: "This payment needs a new payment method instead." };
  }
  try {
    const pi = await getStripe().paymentIntents.retrieve(m.stripe_payment_intent_id);
    return { clientSecret: pi.client_secret ?? undefined, paymentMethodId: m.stripe_payment_method_id ?? undefined };
  } catch (err) {
    return { error: toUserFacingError({ message: (err as Error).message }) };
  }
}

/** After the on-session authentication: re-read the hold from Stripe. */
export async function syncRetryAuthentication(
  tripId: string,
  elementId: string,
  mandateId: string,
): Promise<{ error?: string; outcome?: string }> {
  const m = await loadOwnRetryMandate(mandateId);
  if ("error" in m) return m;
  if (!m.stripe_payment_intent_id) return { error: "Payment not found." };
  try {
    const outcome = await syncRetriedHold(createServiceClient(), m.id, m.funding_request_id, m.stripe_payment_intent_id, await requestOrigin());
    revalidateFunding(tripId, elementId);
    return { outcome };
  } catch (err) {
    return { error: toUserFacingError({ message: (err as Error).message }) };
  }
}

/** Organizer: give the person more time (capped inside the hold lifetime). */
export async function extendPaymentRetry(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  hours: number,
): Promise<{ error?: string; retryDeadline?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("extend_funding_retry", {
    p_funding_request_id: fundingRequestId,
    p_hours: Math.round(hours),
  });
  if (error) return { error: toUserFacingError(error) };
  revalidateFunding(tripId, elementId);
  return { retryDeadline: data as string };
}
