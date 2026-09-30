import "server-only";
import Stripe from "stripe";

/**
 * Server-side Stripe client (flow #4, mandate-based payments).
 *
 * TEST MODE ONLY. Catoco isn't incorporated and has no verified live Stripe
 * account yet, so this refuses to construct a client from anything but a
 * test key (`sk_test_…` / restricted `rk_test_…`). Flipping to live is a
 * deliberate code change here, gated on the founder's written go-ahead —
 * not an env var swap.
 *
 * STRIPE_SECRET_KEY is server-only (never NEXT_PUBLIC_, never committed).
 */
export const STRIPE_LIVEMODE = false;

let client: Stripe | null = null;

/** True when this environment has Stripe wired up at all. Environments
 * without keys (e.g. production today) keep the manual contribution ledger. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error(
      "Refusing to use a non-test Stripe key: payments are test-mode only until incorporation and a verified live account are confirmed.",
    );
  }
  client ??= new Stripe(key, { appInfo: { name: "catoco-mvp" } });
  return client;
}

// Currencies Stripe treats as having no minor unit. Everything else in this
// app (EUR/USD/GBP/…) is 2-decimal.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}

export function fromMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100;
}
