import "server-only";
import type { TravelersBreakdown } from "@/lib/trip-elements";
import type { VendorSearchParams, VendorSearchResponse, VendorSearchResult } from "./types";
import { airportSuggestions } from "./airports";

// Duffel (Flights). TEST token today (duffel_test_…); the same
// DUFFEL_API_KEY becomes the live key after Duffel KYC clears
// post-incorporation — no code change, but nothing here assumes that's
// happened. Search only: this module never creates orders. (The sandbox
// order-creation check is scripts/duffel-sandbox-order-check.mjs, kept out
// of the app on purpose — booking stays manual self-report for every type.)
//
// Flow, per Duffel's v2 docs: POST /air/offer_requests with
// return_offers=true (the default) returns offers in the same response, so
// no separate GET /air/offers poll. Origin/destination must be IATA codes;
// the modal's From/To are free text, so anything that isn't already a
// 3-letter code is resolved through GET /places/suggestions first.
const DUFFEL_BASE = "https://api.duffel.com";
const MAX_RESULTS = 12;

function headers(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Duffel-Version": "v2",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export function duffelConfigured(): boolean {
  return Boolean(process.env.DUFFEL_API_KEY);
}

/**
 * "SFO" / "nyc" / "San Francisco" / "Positano" → an IATA airport or city
 * code: the same lookup the From/To picker shows (lib/vendor-search/
 * airports.ts — geocoded place, its city code, else the nearest airport),
 * taking the top suggestion when the user typed instead of picking.
 */
async function resolveIata(input: string): Promise<string | null> {
  const q = input.trim();
  if (/^[A-Za-z]{3}$/.test(q)) return q.toUpperCase();
  return (await airportSuggestions(q))[0]?.code ?? null;
}

/** Duffel passengers: adults by type, children/infants by age (Duffel derives the fare type). */
function passengersFor(travelers?: TravelersBreakdown): { type?: string; age?: number }[] {
  const adults = Math.max(1, travelers?.adults ?? 1);
  return [
    ...Array.from({ length: adults }, () => ({ type: "adult" })),
    ...(travelers?.children_ages ?? []).map((age) => ({ age: Number(age) })),
    ...(travelers?.infants_ages ?? []).map((age) => ({ age: Number(age) })),
  ];
}

type DuffelSegment = {
  marketing_carrier?: { iata_code?: string; name?: string };
  marketing_carrier_flight_number?: string;
  departing_at?: string;
  arriving_at?: string;
  origin?: { iata_code?: string };
  destination?: { iata_code?: string };
};
type DuffelSlice = { segments?: DuffelSegment[]; duration?: string | null };
type DuffelOffer = {
  id: string;
  total_amount: string;
  total_currency: string;
  expires_at?: string;
  owner?: { name?: string; iata_code?: string; logo_symbol_url?: string };
  slices?: DuffelSlice[];
};

const hhmm = (iso?: string) => (iso && iso.length >= 16 ? iso.slice(11, 16) : "");

/** "PT7H35M" → "7h 35m" */
function formatDuration(iso?: string | null): string {
  if (!iso) return "";
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!m) return "";
  const hours = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0);
  const mins = Number(m[3] ?? 0);
  return [hours ? `${hours}h` : "", mins ? `${mins}m` : ""].filter(Boolean).join(" ");
}

const stopsLabel = (n: number) => (n === 0 ? "Nonstop" : n === 1 ? "1 stop" : `${n} stops`);

export async function duffelSearch(params: VendorSearchParams): Promise<VendorSearchResponse> {
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) {
    // Same graceful degrade as viatorSearch(): reads as "nothing found",
    // never a crashed modal.
    return { status: "mock", vendorLabel: "Mock data — Duffel key not configured", results: [] };
  }
  const label = apiKey.startsWith("duffel_test_") ? "Duffel (test mode)" : "Duffel";

  const fromText = (params.location ?? "").trim();
  const toText = (params.destination ?? "").trim();
  if (!fromText || !toText || !params.startDate) {
    return { status: "live", vendorLabel: label, results: [] };
  }

  const [origin, destination] = await Promise.all([resolveIata(fromText), resolveIata(toText)]);
  if (!origin || !destination) {
    const missing = !origin ? fromText : toText;
    return {
      status: "live",
      vendorLabel: label,
      results: [],
      notice: `Couldn't find an airport for "${missing}" — pick one from the list, or type an airport code (e.g. SFO).`,
    };
  }

  // endDate present = round trip (the modal omits it for one-way) — the
  // existing convention, no new param plumbing.
  const roundTrip = Boolean(params.endDate);
  const slices = [{ origin, destination, departure_date: params.startDate }];
  if (roundTrip) slices.push({ origin: destination, destination: origin, departure_date: params.endDate! });
  const passengers = passengersFor(params.travelers);

  const url = new URL(`${DUFFEL_BASE}/air/offer_requests`);
  url.searchParams.set("return_offers", "true");
  url.searchParams.set("supplier_timeout", "15000");
  const res = await fetch(url, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ data: { slices, passengers, cabin_class: "economy" } }),
  });
  if (!res.ok) {
    throw new Error(`Duffel search failed (${res.status})`);
  }

  const offers = ((await res.json())?.data?.offers ?? []) as DuffelOffer[];
  const results: VendorSearchResult[] = offers
    .slice()
    .sort((a, b) => Number(a.total_amount) - Number(b.total_amount))
    .slice(0, MAX_RESULTS)
    .map((o) => {
      const out = o.slices?.[0];
      const segs = out?.segments ?? [];
      const first = segs[0];
      const last = segs[segs.length - 1];
      const flightNumber = first
        ? `${first.marketing_carrier?.iata_code ?? ""} ${first.marketing_carrier_flight_number ?? ""}`.trim()
        : "";
      const departTime = hhmm(first?.departing_at);
      const arrivalTime = hhmm(last?.arriving_at);
      const duration = formatDuration(out?.duration);
      // Duffel's total covers every passenger; options are compared and
      // funded per person, so divide (same per_person basis the mock used).
      const perPerson = Math.round((Number(o.total_amount) / passengers.length) * 100) / 100;
      const airline = o.owner?.name ?? first?.marketing_carrier?.name ?? "Flight";
      return {
        id: o.id,
        title: `${airline} — ${origin} → ${destination}`,
        description: [flightNumber, departTime && arrivalTime ? `${departTime} → ${arrivalTime}` : "", stopsLabel(Math.max(0, segs.length - 1)), duration]
          .filter(Boolean)
          .join(" · "),
        // No public booking page exists for a Duffel offer — the offer ID
        // below is the reference instead (validateOptionValue exempts
        // vendor-sourced flights from the link requirement, and submitOption
        // re-verifies the offer with Duffel server-side).
        booking_link: "",
        price: perPerson,
        currency: o.total_currency,
        pricing_basis: "per_person",
        extra: {
          depart_date: params.startDate,
          ...(roundTrip ? { return_date: params.endDate } : {}),
          flight_number: flightNumber,
          depart_time: departTime,
          arrival_time: arrivalTime,
          travelers: params.travelers,
          vendor_source: "duffel",
          vendor_offer_id: o.id,
          vendor_offer_expires_at: o.expires_at,
        },
      };
    });

  return { status: "live", vendorLabel: label, results };
}

export type VerifiedDuffelOffer = { perPersonPrice: number; currency: string; expiresAt?: string };

/**
 * Server-side check at submit time: the offer must really exist on our
 * Duffel account (the link exemption can't rest on a client-supplied flag),
 * and its price comes from Duffel, not from the browser. Returns null when
 * the offer is unknown or expired.
 */
export async function verifyDuffelOffer(offerId: string, passengerCount: number): Promise<VerifiedDuffelOffer | null> {
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey || !/^off_[A-Za-z0-9]+$/.test(offerId)) return null;
  const res = await fetch(`${DUFFEL_BASE}/air/offers/${offerId}`, { headers: headers(apiKey) });
  if (!res.ok) return null;
  const o = (await res.json())?.data as DuffelOffer | undefined;
  if (!o) return null;
  if (o.expires_at && new Date(o.expires_at) <= new Date()) return null;
  return {
    perPersonPrice: Math.round((Number(o.total_amount) / Math.max(1, passengerCount)) * 100) / 100,
    currency: o.total_currency,
    expiresAt: o.expires_at,
  };
}

// ============================================================================
// Duffel Stays + Cars — search only, built from Duffel's documented schemas.
//
// Both products are switched OFF on our Duffel account today (the API
// answers 403 "This feature is not enabled for your account"); access is
// requested through Duffel. Each is also behind its own flag
// (DUFFEL_STAYS_ENABLED / DUFFEL_CARS_ENABLED, default off) so hotel/car
// search stays on labeled mock data until the live responses have been
// checked AND the pick path exists: like flights, these results have no
// booking link, so choosing one needs the same server-side re-verification
// flights have — not written until it can be tested against real data.
// ============================================================================

export class DuffelNotEnabledError extends Error {}

async function duffelPost(apiKey: string, path: string, body: unknown) {
  const res = await fetch(`${DUFFEL_BASE}${path}`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ data: body }),
  });
  if (res.status === 403) {
    const text = await res.text();
    if (/not enabled/i.test(text)) throw new DuffelNotEnabledError(text);
    throw new Error(`Duffel ${path} forbidden (403)`);
  }
  if (!res.ok) throw new Error(`Duffel ${path} failed (${res.status})`);
  return (await res.json())?.data;
}

const nightsBetween = (a?: string, b?: string) =>
  a && b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) : 1;

type StaysResult = {
  id: string;
  cheapest_rate_total_amount?: string;
  cheapest_rate_currency?: string;
  expires_at?: string;
  accommodation?: {
    id?: string;
    name?: string;
    photos?: { url?: string }[];
    rating?: number | null;
    review_score?: number | null;
    review_count?: number | null;
    location?: { address?: { line_one?: string; city_name?: string; country_code?: string } };
  };
};

export async function duffelStaysSearch(
  params: VendorSearchParams,
  coords: { lat: number; lng: number },
): Promise<VendorSearchResponse> {
  const apiKey = process.env.DUFFEL_API_KEY!;
  const label = apiKey.startsWith("duffel_test_") ? "Duffel Stays (test mode)" : "Duffel Stays";
  if (!params.startDate || !params.endDate) return { status: "live", vendorLabel: label, results: [] };

  const adults = Math.max(1, params.travelers?.adults ?? 1);
  const guests = [
    ...Array.from({ length: adults }, () => ({ type: "adult" })),
    ...(params.travelers?.children_ages ?? []).map((age) => ({ type: "child", age: Number(age) })),
  ];
  const data = await duffelPost(apiKey, "/stays/search", {
    rooms: 1,
    guests,
    check_in_date: params.startDate,
    check_out_date: params.endDate,
    location: { radius: 5, geographic_coordinates: { latitude: coords.lat, longitude: coords.lng } },
  });

  const nights = nightsBetween(params.startDate, params.endDate);
  const results: VendorSearchResult[] = ((data?.results ?? []) as StaysResult[])
    .filter((r) => r.cheapest_rate_total_amount)
    .sort((a, b) => Number(a.cheapest_rate_total_amount) - Number(b.cheapest_rate_total_amount))
    .slice(0, MAX_RESULTS)
    .map((r) => {
      const a = r.accommodation ?? {};
      const addr = a.location?.address;
      return {
        id: r.id,
        title: a.name ?? "Accommodation",
        description: [
          a.rating ? `${a.rating}★` : "",
          a.review_score ? `${a.review_score}/10${a.review_count ? ` (${a.review_count})` : ""}` : "",
          [addr?.line_one, addr?.city_name].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(" · "),
        thumbnail_url: a.photos?.[0]?.url,
        booking_link: "",
        // Duffel quotes the whole stay; options are compared/funded per night
        // (calculate_required_amount multiplies by the trip's locked nights).
        price: Math.round((Number(r.cheapest_rate_total_amount) / nights) * 100) / 100,
        currency: r.cheapest_rate_currency,
        pricing_basis: "per_night",
        extra: {
          dates: { start_date: params.startDate, end_date: params.endDate },
          travelers: params.travelers,
          vendor_source: "duffel_stays",
          vendor_offer_id: r.id,
          vendor_offer_expires_at: r.expires_at,
        },
      };
    });
  return { status: "live", vendorLabel: label, results };
}

type CarRate = {
  id: string;
  total_amount?: string;
  total_currency?: string;
  supplier?: { name?: string; logo_url?: string };
  pickup_location?: { name?: string; address?: string };
  car?: {
    name?: string;
    category?: string;
    type?: string;
    transmission?: string;
    max_passengers?: number;
    air_conditioning?: boolean;
    baggage?: { small?: number; large?: number };
    images?: { url?: string }[];
  };
};

// The app collects no driver details yet; Duffel's search needs an age and a
// residence country to price. Placeholder defaults for SEARCH only — a real
// booking step would have to collect the actual driver's.
const SEARCH_DRIVER = { age: 30, residence_country_code: "NL" };

export async function duffelCarsSearch(
  params: VendorSearchParams,
  coords: { lat: number; lng: number },
): Promise<VendorSearchResponse> {
  const apiKey = process.env.DUFFEL_API_KEY!;
  const label = apiKey.startsWith("duffel_test_") ? "Duffel Cars (test mode)" : "Duffel Cars";
  if (!params.startDate || !params.endDate) return { status: "live", vendorLabel: label, results: [] };

  const point = { radius: 10, geographic_coordinates: { latitude: coords.lat, longitude: coords.lng } };
  const data = await duffelPost(apiKey, "/cars/search", {
    pickup_date: params.startDate,
    pickup_time: "10:00",
    dropoff_date: params.endDate,
    dropoff_time: "10:00",
    pickup_location: point,
    dropoff_location: point,
    driver: SEARCH_DRIVER,
  });

  const days = nightsBetween(params.startDate, params.endDate);
  const wantTransmission = params.transmission || "";
  const results: VendorSearchResult[] = ((data?.rates ?? []) as CarRate[])
    .filter((r) => r.total_amount)
    .filter((r) => !wantTransmission || (r.car?.transmission ?? "").toLowerCase() === wantTransmission)
    .sort((a, b) => Number(a.total_amount) - Number(b.total_amount))
    .slice(0, MAX_RESULTS)
    .map((r) => {
      const car = r.car ?? {};
      const transmission = (car.transmission ?? "").toLowerCase();
      return {
        id: r.id,
        title: `${car.name ?? car.category ?? "Car"} — ${r.supplier?.name ?? "Rental"}`,
        description: [
          car.category,
          transmission ? transmission[0].toUpperCase() + transmission.slice(1) : "",
          car.max_passengers ? `${car.max_passengers} seats` : "",
          r.pickup_location?.name,
        ]
          .filter(Boolean)
          .join(" · "),
        thumbnail_url: car.images?.[0]?.url,
        booking_link: "",
        price: Math.round((Number(r.total_amount) / days) * 100) / 100,
        currency: r.total_currency,
        pricing_basis: "per_night",
        extra: {
          pickup_location: r.pickup_location?.name ?? params.location ?? "",
          pickup_datetime: params.startDate,
          dropoff_datetime: params.endDate,
          vehicle_type: car.category ?? car.type ?? "",
          transmission: transmission === "manual" || transmission === "automatic" ? transmission : "",
          vendor_source: "duffel_cars",
          vendor_offer_id: r.id,
        },
      };
    });
  return { status: "live", vendorLabel: label, results };
}
