import "server-only";
import type { TravelersBreakdown } from "@/lib/trip-elements";
import { duffelSearch } from "./duffel";
import { verifyLiteapiHotel } from "./liteapi";
import { HotelbedsUnavailableError, verifyHotelbedsActivity, verifyHotelbedsHotel, verifyHotelbedsTransfer } from "./hotelbeds";

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

  if (source === "hotelbeds" || source === "hotelbeds_activities" || source === "hotelbeds_transfers") {
    try {
      if (source === "hotelbeds_transfers") {
        const t = await verifyHotelbedsTransfer(value);
        if (!t) return { ok: false, reason: "That transfer isn't available anymore." };
        return { ok: true, unitPrice: t.total, currency: t.currency };
      }
      if (source === "hotelbeds") {
        const dates = (value.dates ?? {}) as { start_date?: string; end_date?: string };
        const stay = await verifyHotelbedsHotel(
          String(value.vendor_offer_id ?? ""),
          String(dates.start_date ?? ""),
          String(dates.end_date ?? ""),
          travelers,
          value.vendor_rate as { room_code?: string; board_code?: string } | undefined,
        );
        if (!stay) return { ok: false, reason: "The hotel no longer has availability for these dates." };
        return { ok: true, unitPrice: stay.perNightPrice, currency: stay.currency };
      }
      const act = await verifyHotelbedsActivity(String(value.vendor_offer_id ?? ""), String(value.date ?? ""), travelers);
      if (!act) return { ok: false, reason: "The activity isn't available on this date anymore." };
      return { ok: true, unitPrice: act.perPersonPrice, currency: act.currency };
    } catch (err) {
      // Test quota used up: not a price change — the next run tries again.
      if (err instanceof HotelbedsUnavailableError) return { ok: false, reason: "Hotelbeds can't be reached right now — try again later." };
      throw err;
    }
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

  if (source === "viator") {
    // TODO(viator): needs a verifyViatorOffer()-style re-quote in
    // lib/vendor-search/viator.ts (it only exports viatorSearch today).
    return { ok: false, reason: "Catoco can't auto-recheck Viator prices yet — check the listing yourself." };
  }
  if (!source) {
    return { ok: false, reason: "This price was entered by hand — update it manually." };
  }
  // A vendor added before requoteOption learned about it: say so honestly.
  return { ok: false, reason: `Catoco can't auto-recheck ${source} prices yet.` };
}
