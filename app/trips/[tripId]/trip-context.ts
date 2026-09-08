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
  if (optionIds.length === 0) return ctx;

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
  return ctx;
}
