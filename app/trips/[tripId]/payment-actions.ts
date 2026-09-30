"use server";

import { revalidatePath } from "next/cache";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { toUserFacingError } from "@/lib/action-errors";
import { getStripe, stripeConfigured } from "@/lib/stripe/server";
import { activateFromSetupIntent, getOrCreateStripeCustomer } from "@/lib/stripe/mandates";
import { refundOwedContributions } from "@/lib/stripe/charges";

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
