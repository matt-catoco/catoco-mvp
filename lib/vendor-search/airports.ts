import "server-only";
import { geocodePlace } from "./geo";

// City / airport lookup for flight search (Duffel). Duffel's own name search
// is fuzzy in a way that's actively wrong for a free-text box ("Vail" →
// Dakhla, Vanimo, Prague; "Positano" → nothing), so places are anchored on
// a Mapbox geocode first and Duffel is asked for airports NEAR that point.
// Duffel's name match is kept only when it's a city (a multi-airport code
// like NYC/LON) that sits at the same place.
const DUFFEL_BASE = "https://api.duffel.com";
const NEARBY_RADIUS_M = 150_000;
const CITY_MATCH_KM = 60;
const MAX_SUGGESTIONS = 6;

export type AirportSuggestion = {
  /** IATA airport code, or a city code covering every airport in it (NYC). */
  code: string;
  kind: "city" | "airport";
  name: string;
  /** e.g. "All airports · EWR, JFK, LGA" or "Naples, IT · 45 km away" */
  detail: string;
};

type DuffelPlace = {
  type?: "city" | "airport";
  name?: string;
  iata_code?: string;
  iata_city_code?: string;
  iata_country_code?: string;
  city_name?: string;
  latitude?: number;
  longitude?: number;
  airports?: { iata_code?: string }[] | null;
  /** Set on an airport that belongs to a multi-airport city (JFK → NYC). */
  city?: { iata_code?: string; name?: string } | null;
};

function headers(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, "Duffel-Version": "v2", Accept: "application/json" };
}

async function suggestions(apiKey: string, params: Record<string, string>): Promise<DuffelPlace[]> {
  const url = new URL(`${DUFFEL_BASE}/places/suggestions`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Duffel place lookup failed (${res.status})`);
  return ((await res.json())?.data ?? []) as DuffelPlace[];
}

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function cityEntry(p: DuffelPlace): AirportSuggestion | null {
  const code = p.iata_city_code || p.iata_code;
  if (!code) return null;
  const airports = (p.airports ?? []).map((a) => a.iata_code).filter(Boolean);
  return {
    code,
    kind: "city",
    name: p.name ?? code,
    detail: airports.length > 1 ? `All airports · ${airports.join(", ")}` : "All airports",
  };
}

function airportEntry(p: DuffelPlace, distanceKm?: number): AirportSuggestion | null {
  if (!p.iata_code) return null;
  const where = [p.city_name, p.iata_country_code].filter(Boolean).join(", ");
  const away = distanceKm !== undefined && distanceKm >= 5 ? `${Math.round(distanceKm)} km away` : "";
  return { code: p.iata_code, kind: "airport", name: p.name ?? p.iata_code, detail: [where, away].filter(Boolean).join(" · ") };
}

/**
 * Suggestions for a From/To box: the place's city code first (when it has
 * one), then the nearest airports with distances. A typed 3-letter code is
 * looked up as-is.
 */
export async function airportSuggestions(query: string): Promise<AirportSuggestion[]> {
  const apiKey = process.env.DUFFEL_API_KEY;
  const q = query.trim();
  if (!apiKey || q.length < 2) return [];

  const out: AirportSuggestion[] = [];
  const add = (s: AirportSuggestion | null) => {
    if (s && !out.some((o) => o.code === s.code)) out.push(s);
  };

  if (/^[A-Za-z]{3}$/.test(q)) {
    for (const p of await suggestions(apiKey, { query: q.toUpperCase() })) {
      if ((p.iata_code ?? "").toUpperCase() === q.toUpperCase() || (p.iata_city_code ?? "").toUpperCase() === q.toUpperCase()) {
        add(p.type === "city" ? cityEntry(p) : airportEntry(p));
      }
    }
    if (out.length) return out;
  }

  const [geo, byName] = await Promise.all([
    geocodePlace(q),
    suggestions(apiKey, { query: q.split(",")[0].trim() }).catch(() => [] as DuffelPlace[]),
  ]);

  if (!geo) {
    // No map anchor (e.g. no Mapbox token): best effort on Duffel's own match.
    for (const p of byName.slice(0, MAX_SUGGESTIONS)) add(p.type === "city" ? cityEntry(p) : airportEntry(p));
    return out;
  }

  const nearby = (
    await suggestions(apiKey, { lat: String(geo.lat), lng: String(geo.lng), rad: String(NEARBY_RADIUS_M) })
  )
    .filter((p) => p.type === "airport" && p.latitude != null && p.longitude != null)
    .map((p) => ({ p, d: km(geo.lat, geo.lng, p.latitude!, p.longitude!) }))
    .sort((a, b) => a.d - b.d);

  // Multi-airport city at the place → its all-airports code first. Duffel
  // cities carry no coordinates, so the match is "the closest airport that
  // belongs to a city"; prefer Duffel's own city record (it lists airports).
  const cityCode = nearby.find(({ p, d }) => d <= CITY_MATCH_KM && p.city?.iata_code)?.p.city;
  if (cityCode?.iata_code) {
    const record = byName.find((p) => p.type === "city" && p.iata_city_code === cityCode.iata_code);
    add(
      record
        ? cityEntry(record)
        : cityEntry({
            type: "city",
            name: cityCode.name,
            iata_city_code: cityCode.iata_code,
            airports: nearby.filter(({ p }) => p.city?.iata_code === cityCode.iata_code).map(({ p }) => ({ iata_code: p.iata_code })),
          }),
    );
  }

  nearby.forEach(({ p, d }) => add(airportEntry(p, d)));

  return out.slice(0, MAX_SUGGESTIONS);
}
