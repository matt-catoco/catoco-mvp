// Collection modes (three-prong build, Prompt 0, founder 2026-10-22). Pure
// definitions shared by server and client; the flags that decide which
// modes can be SELECTED live server-side in lib/collection-mode-flags.ts.

export const COLLECTION_MODES = ["peer_pledge", "catoco_psp", "vendor_direct"] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];
/**
 * The two the organizer picks between at funding ("Payment method", founder
 * 2026-10-22). vendor_direct isn't a payment choice: it follows from sending
 * the element to the supplier marketplace (request a quote), which is decided
 * when the element is added, long before funding.
 */
export const PAYMENT_METHODS = ["peer_pledge", "catoco_psp"] as const satisfies readonly CollectionMode[];
export const isCollectionMode = (v: unknown): v is CollectionMode =>
  typeof v === "string" && (COLLECTION_MODES as readonly string[]).includes(v);

/**
 * How an element gets booked. Launch scope (2026-10-22 amendment): only
 * affiliate_link and proposed_link exist as real routes. api_booking is
 * Prompt 5 (Duffel/LiteAPI orders) and is INTENTIONALLY UNBUILT for this
 * launch; supplier_bid arrives with Prompt 3's demo.
 */
export type BookingRoute = "api_booking" | "affiliate_link" | "supplier_bid" | "proposed_link";

/** Does Catoco earn supplier income (commission / kickback) on this route? */
export function routeHasSupplierIncome(route: BookingRoute): boolean {
  switch (route) {
    case "affiliate_link": // affiliate commission
    case "api_booking": // booking kickback (Prompt 5)
      return true;
    case "supplier_bid": // marketplace: no kickback, Catoco stays on the buyer's side
    case "proposed_link": // a link someone pasted: no income
      return false;
  }
}

/**
 * The one-sided fee rule (PROVISIONAL, pending the lawyer): a Catoco fee is
 * only offered in a mode where Catoco handles the payment AND receives no
 * supplier income on that booking route. Pledge-only never carries a fee —
 * Catoco doesn't touch the money there.
 */
export function feeAllowed(mode: CollectionMode, route: BookingRoute): boolean {
  if (mode === "peer_pledge") return false;
  return !routeHasSupplierIncome(route);
}
