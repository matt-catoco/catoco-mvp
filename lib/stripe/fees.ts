/**
 * Stripe processing-fee math for the mandate flow (client-safe, no secrets).
 *
 * Catoco's Stripe account is NL-domiciled, so EEA pricing applies — NOT the
 * US-domestic 2.9% + $0.30:
 *   - Cards (standard EEA): 1.5% + €0.25 — percentage-based
 *   - SEPA Direct Debit:    €0.35 flat per successful charge
 *
 * These constants are a documented FALLBACK for estimates shown before a
 * charge exists. Stripe has no pricing API; the real fee for every actual
 * charge is read from its balance transaction and stored on
 * funding_contributions.stripe_fee (see lib/stripe/charges.ts), which is
 * the number to trust after the fact. Non-EEA / international cards cost
 * more than 1.5% — the card figure is a floor, labeled as an estimate.
 * Fixed fees are EUR amounts; for a non-EUR trip they're shown as the same
 * nominal amount in the trip currency, which is only an approximation.
 *
 * The two methods deliberately have different formula SHAPES, not one
 * formula with swapped constants: a card fee scales with the amount, so
 * grossing up needs division; SEPA's is a flat add/subtract.
 */

export type MandatePaymentMethod = "card" | "sepa_debit";

export const CARD_PERCENT = 0.015;
export const CARD_FIXED = 0.25;
export const SEPA_FLAT = 0.35;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Estimated fee Stripe keeps when charging `amount`. */
export function estimateFee(amount: number, method: MandatePaymentMethod): number {
  if (method === "sepa_debit") return SEPA_FLAT;
  return round2(amount * CARD_PERCENT + CARD_FIXED);
}

/** What lands after fees when charging `amount`. */
export function netAfterFee(amount: number, method: MandatePaymentMethod): number {
  if (method === "sepa_debit") return round2(amount - SEPA_FLAT);
  return round2(amount - (amount * CARD_PERCENT + CARD_FIXED));
}

/** The amount to charge so that `net` lands after fees. Not applied to
 * charges today (a contribution is locked to exactly individual_amount);
 * here for when/if a pass-fees-to-participant model is decided. */
export function grossUp(net: number, method: MandatePaymentMethod): number {
  if (method === "sepa_debit") return round2(net + SEPA_FLAT);
  return Math.ceil(((net + CARD_FIXED) / (1 - CARD_PERCENT)) * 100) / 100;
}
