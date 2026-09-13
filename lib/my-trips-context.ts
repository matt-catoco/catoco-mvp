import type { createClient } from "@/lib/supabase/server";
import type { DatesValue, DestinationValue } from "@/lib/trip-elements";

/**
 * My Trips card context — batched across every trip the signed-in user can
 * see, not one `getTripContext()` call per trip (app/trips/[tripId]/
 * trip-context.ts's own version, built for a single trip's detail page —
 * looping it here would be an N+1 query that gets worse as trip count
 * grows). Same resolution rules as that single-trip version (locked
 * Destination/Dates, falling back to a locked Accommodation's own location/
 * dates when neither exists), with one real difference: `destinations` is
 * every locked Destination element's name, in creation order, not just the
 * last one — a multi-city or subgroup-split trip has more than one, and the
 * single-trip version silently drops all but the last since it only ever
 * fed a cross-element pre-fill (one destination is all that needed).
 */
export type MyTripCardContext = {
  destinations: string[];
  dates: DatesValue | null;
};

type LockedElementRow = {
  trip_id: string;
  type: "destination" | "dates";
  locked_option_id: string | null;
};
type OptionValueRow = { id: string; value: Record<string, unknown> };
type AccomRow = { trip_id: string; locked_option_id: string };

export async function getMyTripsContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripIds: string[],
): Promise<Map<string, MyTripCardContext>> {
  const result = new Map<string, MyTripCardContext>();
  for (const id of tripIds) result.set(id, { destinations: [], dates: null });
  if (tripIds.length === 0) return result;

  const { data: elements } = await supabase
    .from("trip_elements")
    .select("trip_id, type, locked_option_id")
    .in("trip_id", tripIds)
    .eq("state", "locked")
    .in("type", ["destination", "dates"])
    .order("created_at", { ascending: true })
    .returns<LockedElementRow[]>();

  const optionIds = (elements ?? [])
    .map((e) => e.locked_option_id)
    .filter((id): id is string => id != null);
  const valueById = new Map<string, Record<string, unknown>>();
  if (optionIds.length > 0) {
    const { data: options } = await supabase
      .from("element_options")
      .select("id, value")
      .in("id", optionIds)
      .returns<OptionValueRow[]>();
    for (const o of options ?? []) valueById.set(o.id, o.value);
  }

  for (const row of elements ?? []) {
    const value = row.locked_option_id ? valueById.get(row.locked_option_id) : null;
    if (!value) continue;
    const ctx = result.get(row.trip_id);
    if (!ctx) continue;
    if (row.type === "destination") {
      const v = value as DestinationValue;
      if (v.name) ctx.destinations.push(v.name);
    } else {
      const v = value as DatesValue;
      if (v.start_date || v.nights) {
        ctx.dates = { start_date: v.start_date, end_date: v.end_date, nights: v.nights };
      }
    }
  }

  // Same fallback as getTripContext(): only for trips that came up short
  // above, and only Accommodations — matching its own "starting with
  // Accommodations only" scope note.
  const needsFallback = tripIds.filter((id) => {
    const ctx = result.get(id)!;
    return ctx.destinations.length === 0 || !ctx.dates;
  });

  if (needsFallback.length > 0) {
    const { data: accomRows } = await supabase
      .from("trip_elements")
      .select("trip_id, locked_option_id")
      .in("trip_id", needsFallback)
      .eq("state", "locked")
      .eq("type", "accommodation")
      .not("locked_option_id", "is", null)
      .order("created_at", { ascending: true })
      .returns<AccomRow[]>();

    const accomOptionIds = (accomRows ?? []).map((r) => r.locked_option_id);
    const accomValueById = new Map<string, Record<string, unknown>>();
    if (accomOptionIds.length > 0) {
      const { data: accomOptions } = await supabase
        .from("element_options")
        .select("id, value")
        .in("id", accomOptionIds)
        .returns<OptionValueRow[]>();
      for (const o of accomOptions ?? []) accomValueById.set(o.id, o.value);
    }

    // Whichever locked Accommodation comes first (creation order) wins per
    // trip, per field — same "don't reconcile across multiple candidates"
    // rule as the single-trip version.
    const filledDest = new Set<string>();
    const filledDates = new Set<string>();
    for (const row of accomRows ?? []) {
      const ctx = result.get(row.trip_id);
      const v = accomValueById.get(row.locked_option_id);
      if (!ctx || !v) continue;
      if (
        ctx.destinations.length === 0 &&
        !filledDest.has(row.trip_id) &&
        typeof v.location_name === "string" &&
        v.location_name.trim()
      ) {
        ctx.destinations.push(v.location_name.trim());
        filledDest.add(row.trip_id);
      }
      if (!ctx.dates && !filledDates.has(row.trip_id) && v.dates && typeof v.dates === "object") {
        const d = v.dates as DatesValue;
        if (d.start_date || d.nights) {
          ctx.dates = { start_date: d.start_date, end_date: d.end_date, nights: d.nights };
          filledDates.add(row.trip_id);
        }
      }
    }
  }

  return result;
}
