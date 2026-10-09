/**
 * Catoco's platform fee (founder, 2026-10-09): added ON TOP of each
 * participant's share — the share still covers the vendor in full. The rate
 * is snapshotted per funding request (funding_requests.platform_fee_percent),
 * so requests created before the fee existed stay at 0. Client-safe.
 */
export const PLATFORM_FEE_PERCENT = 5;

/** Fee on a share, rounded to cents — matches get_funding_charge_batch(). */
export function platformFee(share: number, percent: number): number {
  return Math.round(share * percent) / 100;
}
