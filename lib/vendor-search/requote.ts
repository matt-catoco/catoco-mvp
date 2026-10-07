import "server-only";
import type { TravelersBreakdown } from "@/lib/trip-elements";
import { duffelSearch } from "./duffel";
import { verifyLiteapiHotel } from "./liteapi";

export type Requote =
  | { ok: true; unitPrice: number; currency: string }
  | { ok: false; reason: string };

/**
 * Re-prices a locked vendor-sourced option against the vendor, for the
 * price cushion (a Duffel fare is held ~30 minutes; hotel rates move too).
 * Returns the current UNIT price in the option's own pricing basis
 * (per_person for flights, per_night for stays). Never books anything.
 *
 *  - LiteAPI: the hotel id + stay dates + party → current per-night rate.
 *  - Duffel: offers can't be re-fetched once expired, so the same route and
 *    dates are searched again and the SAME flight (number + departure time)
 *    is matched; no match = the flight is gone or sold out at that fare.
 */
export async function requoteOption(value: Record<string, unknown>): Promise<Requote> {
  const source = String(value.vendor_source ?? "");
  const travelers = value.travelers as TravelersBreakdown | undefined;

  if (source === "liteapi") {
    const dates = (value.dates ?? {}) as { start_date?: string; end_date?: string };
    const stay = await verifyLiteapiHotel(
      String(value.vendor_offer_id ?? ""),
      String(dates.start_date ?? ""),
      String(dates.end_date ?? ""),
      travelers,
    );
    if (!stay) return { ok: false, reason: "The hotel no longer has availability for these dates." };
    return { ok: true, unitPrice: stay.perNightPrice, currency: stay.currency };
  }

  if (source === "duffel") {
    const res = await duffelSearch({
      elementType: "travel",
      searchSubtype: "flight",
      location: String(value.start_location ?? ""),
      destination: String(value.destination_location ?? ""),
      startDate: String(value.depart_date ?? ""),
      endDate: value.return_date ? String(value.return_date) : undefined,
      travelers,
    });
    const flightNumber = String(value.flight_number ?? "").trim();
    const departTime = String(value.depart_time ?? "").trim();
    const match = res.results.find((r) => {
      const extra = (r.extra ?? {}) as Record<string, unknown>;
      return (
        String(extra.flight_number ?? "").trim() === flightNumber &&
        (!departTime || String(extra.depart_time ?? "").trim() === departTime)
      );
    });
    if (!match || typeof match.price !== "number") {
      return { ok: false, reason: "That flight isn't on sale at a matching fare anymore." };
    }
    return { ok: true, unitPrice: match.price, currency: match.currency ?? String(value.currency ?? "USD") };
  }

  return { ok: false, reason: "This price was entered by hand — update it manually." };
}
