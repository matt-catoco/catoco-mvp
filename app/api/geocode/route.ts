import { NextRequest, NextResponse } from "next/server";

export type GeocodeResult = {
  name: string;
  lat: number;
  lng: number;
  placeId: string;
};

type MapboxFeature = {
  id: string;
  text: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
};

/**
 * Mapbox Geocoding-backed place/POI search — used by components/place-
 * picker.tsx for Destination (§3), Experiences (§7), and Dining (§8)
 * location fields. `types` deliberately includes region/district/poi, not
 * just place/locality — a bare city-only type list misses landmark/region
 * queries like "Dolomites", which is exactly the gap flagged when this
 * route was still a stub. MAPBOX_TOKEN is server-only even though the
 * token itself is a Mapbox *public* token (pk.…, safe to expose) — keeping
 * the call server-side matches how every other vendor call in this app is
 * proxied, and leaves room to add caching/rate-limiting here later without
 * a client-side change.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] as GeocodeResult[] });
  }

  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ results: [] as GeocodeResult[] });
  }

  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("types", "country,region,district,place,locality,neighborhood,poi");
  url.searchParams.set("limit", "6");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return NextResponse.json({ results: [] as GeocodeResult[] });
    }
    const data = await res.json();
    const features = (data?.features ?? []) as MapboxFeature[];
    const results: GeocodeResult[] = features.map((f) => ({
      name: f.place_name || f.text,
      lat: f.center[1],
      lng: f.center[0],
      placeId: f.id,
    }));
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] as GeocodeResult[] });
  }
}
