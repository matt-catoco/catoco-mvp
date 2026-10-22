import { providerForOption, type ProviderKey } from "@/lib/providers";
import type { BookingRoute } from "@/lib/collection-modes";

// Which way an element gets booked (three-prong Prompt 1 §5–6, launch-scope
// amendment). At launch only two routes are real:
//   affiliate_link  a partner link (Viator, Booking.com, Travelpayouts, Omio)
//                   — carries our sub-ID so commission can be matched back
//   proposed_link   a link someone pasted — opened as-is
// api_booking (booking through a vendor API with the payer's card) is
// Prompt 5 and is INTENTIONALLY UNBUILT for this launch: an API-sourced
// option without a consumer page (Duffel, LiteAPI, Hotelbeds) has no route
// to book through Catoco yet and is reported as having no link.

const AFFILIATE_PROVIDERS: ProviderKey[] = ["viator", "booking_com", "travelpayouts", "omio"];

/**
 * The query parameter each partner reads a sub-ID from. Viator "campaign",
 * Booking.com "label" and Travelpayouts "sub_id" are their documented
 * tracking fields; confirm each with the partner before relying on the
 * reports. Unknown partners get no parameter (never break someone's link).
 */
const SUB_ID_PARAM: Partial<Record<ProviderKey, string>> = {
  viator: "campaign",
  booking_com: "label",
  travelpayouts: "sub_id",
  omio: "sub_id",
};

export function safeHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** The route an option books through, or null when it has no usable link (incl. API-only, see above). */
export function bookingRouteFor(value: Record<string, unknown>): BookingRoute | null {
  if (!safeHttpUrl(value.booking_link)) return null; // api_booking: intentionally unbuilt (Prompt 5)
  return AFFILIATE_PROVIDERS.includes(providerForOption(value)) ? "affiliate_link" : "proposed_link";
}

/** `<funding_request_id>.<element_id>` */
export function subIdFor(fundingRequestId: string | null, elementId: string): string {
  return `${fundingRequestId ?? "none"}.${elementId}`;
}

/** The outbound URL: affiliate links get our sub-ID; anything else is opened unchanged. */
export function outboundUrl(value: Record<string, unknown>, subId: string): string | null {
  const url = safeHttpUrl(value.booking_link);
  if (!url) return null;
  const provider = providerForOption(value);
  const param = SUB_ID_PARAM[provider];
  if (param && AFFILIATE_PROVIDERS.includes(provider)) url.searchParams.set(param, subId);
  return url.toString();
}
