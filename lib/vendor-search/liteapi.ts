import "server-only";
import type { TravelersBreakdown } from "@/lib/trip-elements";
import type { VendorSearchParams, VendorSearchResponse, VendorSearchResult } from "./types";

// LiteAPI (Nuitée) — hotel search. SANDBOX key today (sand_…); search only,
// booking stays manual. Verified against the live sandbox (2026-10-02,
// Innsbruck): two steps —
//   1. GET  /data/hotels?latitude&longitude&radius  → static content (name,
//      address, stars, rating, reviewCount, main_photo/thumbnail, coords)
//   2. POST /hotels/rates {hotelIds, checkin, checkout, currency,
//      guestNationality, occupancies} → live availability; per hotel,
//      roomTypes[].offerRetailRate {amount, currency} = the whole stay.
// Only hotels with live availability are returned.
const LITEAPI_BASE = "https://api.liteapi.travel/v3.0";
const HOTELS_TO_PRICE = 30;
const MAX_RESULTS = 12;
// The app doesn't collect guest nationality; LiteAPI needs one to price.
// Placeholder for SEARCH only — same caveat as Duffel Cars' driver details.
const SEARCH_GUEST_NATIONALITY = "US";
const SEARCH_CURRENCY = "USD";

export function liteapiConfigured(): boolean {
  return Boolean(process.env.LITEAPI_KEY);
}

function label(): string {
  return process.env.LITEAPI_KEY?.startsWith("sand_") ? "LiteAPI (sandbox)" : "LiteAPI";
}

function headers(): HeadersInit {
  return {
    "X-API-Key": process.env.LITEAPI_KEY!,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

type LiteHotel = {
  id: string;
  name?: string;
  address?: string;
  city?: string;
  stars?: number;
  rating?: number;
  reviewCount?: number;
  main_photo?: string;
  thumbnail?: string;
  latitude?: number;
  longitude?: number;
};

type LiteRates = {
  hotelId: string;
  roomTypes?: { offerId?: string; offerRetailRate?: { amount?: number; currency?: string } }[];
};

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));

function occupancyFor(travelers?: TravelersBreakdown) {
  return [
    {
      adults: Math.max(1, travelers?.adults ?? 1),
      children: [...(travelers?.children_ages ?? []), ...(travelers?.infants_ages ?? [])].map(Number),
    },
  ];
}

/** Cheapest live whole-stay price per hotel id. */
async function fetchRates(
  hotelIds: string[],
  checkin: string,
  checkout: string,
  travelers?: TravelersBreakdown,
): Promise<Map<string, { amount: number; currency: string }>> {
  const res = await fetch(`${LITEAPI_BASE}/hotels/rates`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      hotelIds,
      checkin,
      checkout,
      currency: SEARCH_CURRENCY,
      guestNationality: SEARCH_GUEST_NATIONALITY,
      occupancies: occupancyFor(travelers),
      maxRatesPerHotel: 1,
    }),
  });
  if (!res.ok) throw new Error(`LiteAPI rates failed (${res.status})`);
  const json = await res.json();
  // An error body (e.g. rate limiting) must not read as "no availability".
  // Genuine no-availability is just `data: []` with no error (checked live).
  if (json?.error) {
    throw new Error(`LiteAPI rates error: ${json.error.message ?? json.error.code}`);
  }
  const out = new Map<string, { amount: number; currency: string }>();
  for (const h of (json?.data ?? []) as LiteRates[]) {
    for (const rt of h.roomTypes ?? []) {
      const amount = rt.offerRetailRate?.amount;
      if (typeof amount !== "number") continue;
      const prev = out.get(h.hotelId);
      if (!prev || amount < prev.amount) {
        out.set(h.hotelId, { amount, currency: rt.offerRetailRate?.currency ?? SEARCH_CURRENCY });
      }
    }
  }
  return out;
}

export async function liteapiHotelSearch(
  params: VendorSearchParams,
  coords: { lat: number; lng: number },
): Promise<VendorSearchResponse> {
  if (!params.startDate || !params.endDate) return { status: "live", vendorLabel: label(), results: [] };

  const url = new URL(`${LITEAPI_BASE}/data/hotels`);
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lng));
  url.searchParams.set("radius", "5000");
  url.searchParams.set("limit", String(HOTELS_TO_PRICE));
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`LiteAPI hotels failed (${res.status})`);
  const hotels = ((await res.json())?.data ?? []) as LiteHotel[];
  if (hotels.length === 0) return { status: "live", vendorLabel: label(), results: [] };

  const rates = await fetchRates(hotels.map((h) => h.id), params.startDate, params.endDate, params.travelers);
  const nights = nightsBetween(params.startDate, params.endDate);

  const results: VendorSearchResult[] = hotels
    .filter((h) => rates.has(h.id))
    .map((h) => {
      const rate = rates.get(h.id)!;
      return {
        id: `liteapi-${h.id}`,
        source: "LiteAPI",
        title: h.name ?? "Hotel",
        description: [
          h.stars ? `${h.stars}★` : "",
          h.rating ? `${h.rating}/10${h.reviewCount ? ` (${h.reviewCount})` : ""}` : "",
          h.address,
        ]
          .filter(Boolean)
          .join(" · "),
        thumbnail_url: h.main_photo || h.thumbnail,
        booking_link: "",
        // LiteAPI quotes the whole stay; options are compared/funded per night.
        price: Math.round((rate.amount / nights) * 100) / 100,
        currency: rate.currency,
        pricing_basis: "per_night" as const,
        extra: {
          dates: { start_date: params.startDate, end_date: params.endDate },
          travelers: params.travelers,
          vendor_source: "liteapi",
          // The hotel id, not the offerId: offer ids are re-issued on every
          // rates call, while hotel + dates is what re-verification re-prices.
          vendor_offer_id: h.id,
          note: h.address ? `Address: ${h.address}` : undefined,
        },
      };
    })
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
    .slice(0, MAX_RESULTS);

  return { status: "live", vendorLabel: label(), results };
}

/**
 * Server-side re-check when a LiteAPI hotel is proposed/locked: the hotel
 * must still have live availability for the stored dates/party, and the
 * per-night price comes from LiteAPI, not the browser. Null = unavailable.
 */
export async function verifyLiteapiHotel(
  hotelId: string,
  checkin: string,
  checkout: string,
  travelers?: TravelersBreakdown,
): Promise<{ perNightPrice: number; currency: string } | null> {
  if (!liteapiConfigured() || !/^[A-Za-z0-9_-]{3,40}$/.test(hotelId) || !checkin || !checkout) return null;
  // The pick check fires right after the search's own rate calls, and the
  // sandbox (5 req/s) has been seen to answer one empty under that burst
  // (2026-10-02: same hotel/dates/party priced fine seconds later). One
  // retry after a short pause before calling it truly unavailable.
  let rate = (await fetchRates([hotelId], checkin, checkout, travelers)).get(hotelId);
  if (!rate) {
    await new Promise((r) => setTimeout(r, 1200));
    rate = (await fetchRates([hotelId], checkin, checkout, travelers)).get(hotelId);
  }
  if (!rate) return null;
  return {
    perNightPrice: Math.round((rate.amount / nightsBetween(checkin, checkout)) * 100) / 100,
    currency: rate.currency,
  };
}
