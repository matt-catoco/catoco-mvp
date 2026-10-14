/**
 * Automatic booking (Catoco books with the vendor's API on the group's
 * behalf) is designed but not switched on (founder, 2026-10-14). Every
 * "automatic" branch checks this, so turning it on is one change here once
 * a vendor booking integration exists. Until then every option is booked
 * by hand by the purchaser.
 */
export const AUTOMATIC_BOOKING_ENABLED = false;

/** Whether Catoco would book this option itself (vendor-sourced + enabled). */
export function isAutomaticBooking(optionValue: Record<string, unknown> | null | undefined): boolean {
  if (!AUTOMATIC_BOOKING_ENABLED) return false;
  const vendor = String(optionValue?.vendor_source ?? "");
  return vendor === "duffel" || vendor === "liteapi";
}
