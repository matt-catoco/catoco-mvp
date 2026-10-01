import "server-only";

/**
 * Free-text place → coordinates via Mapbox (same server-only MAPBOX_TOKEN as
 * /api/geocode). Duffel Stays and Cars search by a radius around a point,
 * not by name, so the modal's "Location" text has to be resolved first.
 * Returns null when there's no token or no match — callers treat that as
 * "no results", never an error.
 */
export async function geocodePlace(query: string): Promise<{ lat: number; lng: number; name: string } | null> {
  const token = process.env.MAPBOX_TOKEN;
  const q = query.trim();
  if (!token || !q) return null;
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("types", "country,region,district,place,locality,neighborhood,poi");
  url.searchParams.set("limit", "1");
  const res = await fetch(url);
  if (!res.ok) return null;
  const f = (await res.json())?.features?.[0] as { center?: [number, number]; place_name?: string } | undefined;
  if (!f?.center) return null;
  return { lng: f.center[0], lat: f.center[1], name: f.place_name ?? q };
}
