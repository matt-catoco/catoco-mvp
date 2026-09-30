import "server-only";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { STRIPE_LIVEMODE, getStripe } from "@/lib/stripe/server";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** One Stripe Customer per user (per mode), created on first mandate. */
export async function getOrCreateStripeCustomer(
  supabase: ServiceClient,
  userId: string,
  email: string | undefined,
): Promise<string> {
  const { data: existing, error } = await supabase.rpc("get_stripe_customer", {
    p_user_id: userId,
    p_livemode: STRIPE_LIVEMODE,
  });
  if (error) throw new Error(`get_stripe_customer: ${error.message}`);
  if (existing) return existing as string;

  const customer = await getStripe().customers.create(
    { email, metadata: { user_id: userId } },
    { idempotencyKey: `catoco-customer-${userId}-${STRIPE_LIVEMODE ? "live" : "test"}` },
  );
  // First writer wins if two tabs raced; use whatever ended up stored.
  const { data: stored, error: saveError } = await supabase.rpc("save_stripe_customer", {
    p_user_id: userId,
    p_livemode: STRIPE_LIVEMODE,
    p_stripe_customer_id: customer.id,
  });
  if (saveError) throw new Error(`save_stripe_customer: ${saveError.message}`);
  return stored as string;
}

/**
 * Activates the mandate behind a succeeded SetupIntent. Called from both
 * the setup_intent.succeeded webhook and the client's post-confirm sync —
 * activate_funding_mandate() is idempotent, so whichever lands first wins.
 */
export async function activateFromSetupIntent(supabase: ServiceClient, si: Stripe.SetupIntent) {
  if (si.status !== "succeeded" || !si.payment_method) return null;
  const pm =
    typeof si.payment_method === "string"
      ? await getStripe().paymentMethods.retrieve(si.payment_method)
      : si.payment_method;
  const { data, error } = await supabase.rpc("activate_funding_mandate", {
    p_setup_intent_id: si.id,
    p_payment_method_id: pm.id,
    p_payment_method_type: pm.type,
  });
  if (error) throw new Error(`activate_funding_mandate: ${error.message}`);
  return data as string | null;
}
