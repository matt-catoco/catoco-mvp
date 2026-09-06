import { NextRequest, NextResponse } from "next/server";

export type GeocodeResult = {
  name: string;
  lat: number;
  lng: number;
  placeId: string;
};

/**
 * Mapbox Geocoding-backed place/POI search — used by components/place-
 * picker.tsx for Destination (§3), Experiences (§7), and Dining (§8)
 * location fields. Deliberately NOT wired to a live Mapbox call in this
 * pass (flow-audit prompt's own scope note: build the UI/data model, leave
 * a clean hook, don't wire up live vendor calls here — that's the follow-up
 * prompt once new mockups land). Returns an empty result set unconditionally
 * for now, so the UI degrades to plain typed text rather than being
 * hard-blocked on a selection nothing can ever produce.
 *
 * When wiring the real call: needs to resolve region/landmark-level queries
 * too ("Dolomites"), not just city/town names -- Mapbox's default place
 * types skew toward administrative/postal boundaries and POIs, so test
 * that coverage specifically rather than assuming it works out of the box.
 * MAPBOX_TOKEN would be a new required env var, server-side only.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] as GeocodeResult[] });
  }

  // TODO(next prompt): call Mapbox's Geocoding API here with MAPBOX_TOKEN
  // and map its features to GeocodeResult[]. Until then: no live vendor
  // call, empty results, callers already handle that gracefully.
  return NextResponse.json({ results: [] as GeocodeResult[] });
}
