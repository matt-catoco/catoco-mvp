import type { createClient } from "@/lib/supabase/server";
import type { DatesValue, DestinationValue, TripContext } from "@/lib/trip-elements";

export type { TripContext };

type LockedElementRow = { type: "destination" | "dates"; locked_option_id: string | null };
type OptionValueRow = { id: string; value: Record<string, unknown> };

/**
 * §4: cross-element trip-level data sharing. Once the trip's Destination
 * and/or Dates elements are locked, their values are known context every
 * other element's forms can be pre-filled from (an Accommodations option's
 * location defaults to the trip's destination, its Dates sub-field defaults
 * to the trip's locked dates) instead of asking the same thing over again
 * per element. Read-only, best-effort — returns whatever's locked so far;
 * either or both can be absent early in a trip's life. Two plain queries
 * (elements, then their locked options) rather than an embedded join — no
 * PostgREST FK-name guessing needed since element_options has two possible
 * relationships to trip_elements (element_id, and locked_option_id).
 */
export async function getTripContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  // §7: Trip Home's header wants a destination/dates line even for a trip
  // that never got an explicit Destination/Dates element locked (e.g. a
  // hotel-only-split trip) -- everywhere else this context feeds (cross-
  // element pre-fill) keeps the original explicit-elements-only behavior,
  // so this only turns on for that one caller.
  opts?: { fallbackToLockedAccommodation?: boolean },
): Promise<TripContext> {
  const ctx: TripContext = {};

  // Vendor search: a starting traveler count, so it doesn't need re-entering
  // per search — the trip's actual participant count, not a guess. Always
  // overridable per search (see applyTripContext's own rule).
  const { count: participantCount } = await supabase
    .from("trip_participants")
    .select("user_id", { count: "exact", head: true })
    .eq("trip_id", tripId);
  if (participantCount && participantCount > 0) {
    ctx.travelers = { adults: participantCount };
  }

  const { data: elements } = await supabase
    .from("trip_elements")
    .select("type, locked_option_id")
    .eq("trip_id", tripId)
    .eq("state", "locked")
    .in("type", ["destination", "dates"])
    .returns<LockedElementRow[]>();

  const optionIds = (elements ?? []).map((e) => e.locked_option_id).filter((id): id is string => id != null);
  // §7 regression: this used to `return ctx` here when there was no
  // explicit locked Destination/Dates element at all -- which is exactly
  // the case the fallback below exists to handle (a hotel-only-split trip
  // never has one). No early return anymore; the fallback block simply
  // has nothing to override when this section did find something.
  if (optionIds.length > 0) {
    const { data: options } = await supabase
      .from("element_options")
      .select("id, value")
      .in("id", optionIds)
      .returns<OptionValueRow[]>();
    const valueById = new Map((options ?? []).map((o) => [o.id, o.value]));

    for (const row of elements ?? []) {
      const value = row.locked_option_id ? valueById.get(row.locked_option_id) : null;
      if (!value) continue;
      if (row.type === "destination") {
        const v = value as DestinationValue;
        // name only, deliberately — see TripContext's own comment on why
        // lat/lng/place_id (a stored Mapbox Temporary-mode result) never
        // gets read back out and reused here.
        if (v.name) ctx.destination = { name: v.name };
      } else if (row.type === "dates") {
        const v = value as DatesValue;
        if (v.start_date || v.nights) {
          ctx.dates = { start_date: v.start_date, end_date: v.end_date, nights: v.nights };
        }
      }
    }
  }

  // §7: no explicit Destination/Dates element locked yet -- fall back to a
  // locked Accommodations option's own location_name/dates sub-field
  // (starting with Accommodations only, matching the given example; not
  // Travel/Experience/Dining, extend later if it turns out to matter).
  // Whichever locked Accommodations element comes first wins for whichever
  // field is still missing -- no reconciling across multiple candidates if
  // more than one exists, per the "don't fabricate a trip-wide range"
  // instruction this fallback was built against.
  if (opts?.fallbackToLockedAccommodation && (!ctx.destination || !ctx.dates)) {
    const { data: accomRows } = await supabase
      .from("trip_elements")
      .select("locked_option_id")
      .eq("trip_id", tripId)
      .eq("state", "locked")
      .eq("type", "accommodation")
      .not("locked_option_id", "is", null)
      .order("created_at", { ascending: true })
      .returns<{ locked_option_id: string }[]>();

    const accomOptionIds = (accomRows ?? []).map((r) => r.locked_option_id);
    if (accomOptionIds.length > 0) {
      const { data: accomOptions } = await supabase
        .from("element_options")
        .select("id, value")
        .in("id", accomOptionIds)
        .returns<OptionValueRow[]>();

      for (const opt of accomOptions ?? []) {
        const v = opt.value as Record<string, unknown>;
        if (!ctx.destination && typeof v.location_name === "string" && v.location_name.trim()) {
          ctx.destination = { name: v.location_name };
        }
        if (!ctx.dates && v.dates && typeof v.dates === "object") {
          const d = v.dates as DatesValue;
          if (d.start_date || d.nights) {
            ctx.dates = { start_date: d.start_date, end_date: d.end_date, nights: d.nights };
          }
        }
        if (ctx.destination && ctx.dates) break;
      }
    }
  }

  return ctx;
}
