/**
 * Provider capability config — keyed per VENDOR, never per element type
 * (founder decision). Phase 1 only reads `linkCoverage`/`linkLabel` and the
 * routing defaults; the booking-API fields are recorded now so phase 2
 * (api_order_card) and the legal routing decision can use them without a
 * migration. Every value below is "from provider docs, 2026-10-10,
 * unverified" until confirmed with the provider directly.
 */

export type ProviderKey =
  | "liteapi"
  | "duffel"
  | "duffel_stays"
  | "viator"
  | "booking_com"
  | "travelpayouts"
  | "omio"
  | "manual";

export type LinkCoverage =
  /** the vendor page opens on the exact product with our dates/party filled in */
  | "exact_with_dates"
  /** the exact product page; dates/party chosen on the vendor's side */
  | "exact_product"
  /** a search results page with the route/dates filled in */
  | "search_results"
  /** only the vendor's home page */
  | "home_page"
  /** whatever link the person who added the option pasted */
  | "as_pasted"
  /** no consumer checkout exists (API-only vendor) */
  | "none";

export type ProviderCapabilities = {
  label: string;
  supports_booking_api: boolean | "unknown";
  accepts_external_card: "yes" | "no" | "unknown";
  requires_approval: boolean | "unknown";
  payment_timing_options: ("pay_now" | "pay_later" | "pay_at_property")[];
  cardholder_name_rule: string;
  seller_of_record: "supplier" | "catoco" | "unknown";
  mcp_available: "booking" | "search_only" | "no" | "unknown";
  notes: string;
  /** How much our booking link fills in — shown honestly on Ready to Book. */
  linkCoverage: LinkCoverage;
  verified: string;
};

const UNVERIFIED = "from provider docs, 2026-10-10, unverified";

export const PROVIDERS: Record<ProviderKey, ProviderCapabilities> = {
  liteapi: {
    label: "LiteAPI (hotels)",
    supports_booking_api: true,
    accepts_external_card: "yes",
    requires_approval: "unknown",
    payment_timing_options: ["pay_now", "pay_later", "pay_at_property"],
    cardholder_name_rule: "not stated",
    seller_of_record: "unknown",
    mcp_available: "booking",
    notes:
      "Card incl. virtual cards via a secure booking endpoint that must be enabled on the account; also a user-pays SDK and a credit line. Seller of record not stated. No consumer checkout page — hotels from LiteAPI are booked through the API (phase 2) or by the organizer elsewhere.",
    linkCoverage: "none",
    verified: UNVERIFIED,
  },
  duffel: {
    label: "Duffel (flights)",
    supports_booking_api: true,
    accepts_external_card: "yes",
    requires_approval: true,
    payment_timing_options: ["pay_now"],
    cardholder_name_rule: "card name should match the traveler",
    seller_of_record: "supplier",
    mcp_available: "no",
    notes:
      "Card details passed to the supplier; approval required. Business-issued cards use a 3DS exemption; cards issued to our business may need airline permission for flights. Seller of record unclear (docs say the supplier). Flight orders also need gender + phone per passenger — beyond what we store (stop rule). Flights stay organizer-booked in v1.",
    linkCoverage: "none",
    verified: UNVERIFIED,
  },
  duffel_stays: {
    label: "Duffel Stays",
    supports_booking_api: true,
    accepts_external_card: "yes",
    requires_approval: true,
    payment_timing_options: ["pay_now"],
    cardholder_name_rule: "card name should match the traveler",
    seller_of_record: "supplier",
    mcp_available: "no",
    notes: "As Duffel flights: card passed to the supplier, approval required, no official MCP.",
    linkCoverage: "none",
    verified: UNVERIFIED,
  },
  viator: {
    label: "Viator (experiences)",
    supports_booking_api: true,
    accepts_external_card: "yes",
    requires_approval: true,
    payment_timing_options: ["pay_now"],
    cardholder_name_rule: "not stated",
    seller_of_record: "unknown",
    mcp_available: "search_only",
    notes:
      "Booking needs Full + Booking API access. Card via the payment API (PCI-compliant, no 3DS) or an iFrame. MCP is search only.",
    linkCoverage: "exact_product",
    verified: UNVERIFIED,
  },
  booking_com: {
    label: "Booking.com (hotels, cars)",
    supports_booking_api: "unknown",
    accepts_external_card: "unknown",
    requires_approval: "unknown",
    payment_timing_options: ["pay_now", "pay_later", "pay_at_property"],
    cardholder_name_rule: "not stated",
    seller_of_record: "supplier",
    mcp_available: "no",
    notes:
      "\"Partner collects\" makes us merchant of record — out of scope. \"Booking.com collects\" is the only model that fits. Not integrated yet.",
    linkCoverage: "exact_with_dates",
    verified: UNVERIFIED,
  },
  travelpayouts: {
    label: "Travelpayouts",
    supports_booking_api: false,
    accepts_external_card: "no",
    requires_approval: false,
    payment_timing_options: ["pay_now"],
    cardholder_name_rule: "n/a",
    seller_of_record: "supplier",
    mcp_available: "no",
    notes: "Affiliate redirect only.",
    linkCoverage: "search_results",
    verified: UNVERIFIED,
  },
  omio: {
    label: "Omio",
    supports_booking_api: false,
    accepts_external_card: "no",
    requires_approval: false,
    payment_timing_options: ["pay_now"],
    cardholder_name_rule: "n/a",
    seller_of_record: "supplier",
    mcp_available: "no",
    notes: "Affiliate redirect only. Not integrated yet.",
    linkCoverage: "search_results",
    verified: UNVERIFIED,
  },
  manual: {
    label: "Added by hand",
    supports_booking_api: false,
    accepts_external_card: "unknown",
    requires_approval: false,
    payment_timing_options: ["pay_now", "pay_later", "pay_at_property"],
    cardholder_name_rule: "n/a",
    seller_of_record: "supplier",
    mcp_available: "no",
    notes: "Whatever booking link the person who added the option pasted.",
    linkCoverage: "as_pasted",
    verified: "n/a",
  },
};

export const LINK_COVERAGE_LABEL: Record<LinkCoverage, string> = {
  exact_with_dates: "Opens the exact listing with your dates and group filled in",
  exact_product: "Opens the exact listing — pick the date and group size there",
  search_results: "Opens search results for your route and dates — pick the matching option",
  home_page: "Opens the vendor's site — search for it there",
  as_pasted: "Opens the link that was added with this option",
  none: "No booking page to open — this vendor is booked through its API",
};

/** Which provider an option came from (vendor search sets vendor_source). */
export function providerForOption(value: Record<string, unknown>): ProviderKey {
  const src = typeof value.vendor_source === "string" ? value.vendor_source : "";
  const link = typeof value.booking_link === "string" ? value.booking_link : "";
  if (src === "liteapi") return "liteapi";
  if (src === "duffel") return "duffel";
  if (src === "duffel_stays") return "duffel_stays";
  if (/viator\.com/i.test(link)) return "viator";
  if (/booking\.com/i.test(link)) return "booking_com";
  if (/(aviasales|travelpayouts|tp\.media|hotellook)/i.test(link)) return "travelpayouts";
  if (/omio\./i.test(link)) return "omio";
  return "manual";
}

/**
 * Routing defaults for the booking record (data only; nothing branches on
 * these yet). Phase 1 never places API orders, so every organizer booking
 * is either a redirect to the supplier or a manual buy with an Issuing card.
 */
export function routingDefaults(opts: { usedIssuingCard: boolean }): {
  fulfillment_mode: "affiliate_redirect" | "issuing_manual";
  seller_of_record: "supplier";
} {
  return { fulfillment_mode: opts.usedIssuingCard ? "issuing_manual" : "affiliate_redirect", seller_of_record: "supplier" };
}
