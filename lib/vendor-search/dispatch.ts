import "server-only";
import type { VendorSearchParams, VendorSearchResponse, VendorSearchResult } from "./types";
import { liteapiConfigured, liteapiHotelSearch } from "./liteapi";
import { mockSearch } from "./mock";
import { viatorSearch } from "./viator";
import {
  DuffelNotEnabledError,
  duffelCarsSearch,
  duffelConfigured,
  duffelSearch,
  duffelStaysSearch,
} from "./duffel";
import { geocodePlace } from "./geo";
import {
  HotelbedsUnavailableError,
  hotelbedsActivitySearch,
  hotelbedsConfigured,
  hotelbedsHotelSearch,
} from "./hotelbeds";

// One dispatch point, routing by (elementType, searchSubtype) to whichever
// vendor module actually owns that search today — never by element type
// alone. This is the architectural point of the whole build: Experiences
// routes to Viator today, but nothing stops a second Experiences subtype
// routing to a different vendor later (concert/sports ticketing needs a
// different API than activity-tour search) without touching this shape,
// only adding a case here and a new vendor module next to viator.ts.
export async function searchVendor(params: VendorSearchParams): Promise<VendorSearchResponse> {
  switch (params.elementType) {
    // Experiences: Viator, plus Hotelbeds Activities when configured
    // (founder, 2026-10-19) — one merged list, each card labelled by source.
    case "experience":
      return aggregateExperiences(params);

    // Flight → Duffel (test mode). Rental Car/Train/Bus have no confirmed
    // live vendor and stay on mock — Omio's Travelpayouts feed was checked
    // for Train/Bus and is a static popular-routes catalog (no dates, no
    // live fares); its real-time API is approval-gated.
    case "travel":
      if (params.searchSubtype === "flight") return duffelSearch(params);
      if (params.searchSubtype === "rental_car") {
        return duffelOrMock(params, "DUFFEL_CARS_ENABLED", "Duffel Cars", duffelCarsSearch);
      }
      return mockSearch(params, vendorLabelFor(params));

    // Accommodations: AGGREGATED — every configured hotel source runs in
    // parallel and the results are merged (founder direction: combine APIs
    // to widen the options). LiteAPI is live (sandbox); Duffel Stays joins
    // automatically once enabled on the account and flagged on.
    // (Travelpayouts was ruled out: its hotel data API was Hotellook's,
    // which shut down 2025-10-20 — every hotel endpoint 404s.)
    case "accommodation":
      return aggregateHotels(params);

    case "dining":
      return mockSearch(params, vendorLabelFor(params));

    default:
      return { status: "mock", vendorLabel: "Not available", results: [] };
  }
}

/**
 * Duffel Stays/Cars, each behind its own flag until verified against live
 * responses (see duffel.ts). Not enabled on the Duffel account, flag off, or
 * no key → the same labeled mock data as before, never a crashed modal.
 */
async function duffelOrMock(
  params: VendorSearchParams,
  flag: "DUFFEL_STAYS_ENABLED" | "DUFFEL_CARS_ENABLED",
  product: string,
  search: (p: VendorSearchParams, c: { lat: number; lng: number }) => Promise<VendorSearchResponse>,
): Promise<VendorSearchResponse> {
  if (process.env[flag] !== "true" || !duffelConfigured()) {
    return mockSearch(params, `Mock data — ${product} access pending`);
  }
  const coords = await geocodePlace(params.location ?? "");
  if (!coords) return { status: "live", vendorLabel: product, results: [] };
  try {
    return await search(params, coords);
  } catch (err) {
    if (err instanceof DuffelNotEnabledError) {
      return mockSearch(params, `Mock data — ${product} not enabled on the Duffel account yet`);
    }
    throw err;
  }
}

type CoordSearch = (p: VendorSearchParams, c: { lat: number; lng: number }) => Promise<VendorSearchResponse>;

/**
 * Fans one hotel search out to every configured source in parallel and
 * merges the results:
 *  - a source that's unconfigured, not enabled, or erroring is skipped —
 *    the rest still show (all failing → the first real error surfaces);
 *  - each result is tagged with its source for the card;
 *  - the same hotel from two sources (same name, case/space-insensitive)
 *    keeps only the cheaper offer when both are in the same currency;
 *  - sorted cheapest-first within currency.
 * No live source at all → the same labeled mock data as before.
 */
async function aggregateHotels(params: VendorSearchParams): Promise<VendorSearchResponse> {
  const sources: { name: string; search: CoordSearch }[] = [];
  if (liteapiConfigured()) sources.push({ name: "LiteAPI", search: liteapiHotelSearch });
  if (process.env.DUFFEL_STAYS_ENABLED === "true" && duffelConfigured()) {
    sources.push({ name: "Duffel Stays", search: duffelStaysSearch });
  }
  if (hotelbedsConfigured("hotels")) sources.push({ name: "Hotelbeds", search: hotelbedsHotelSearch });
  if (sources.length === 0) return mockSearch(params, "Mock data — no hotel source configured");

  const coords = await geocodePlace(params.location ?? "");
  if (!coords) return { status: "live", vendorLabel: sources.map((s) => s.name).join(" + "), results: [] };

  const settled = await Promise.allSettled(sources.map((s) => s.search(params, coords)));
  const live: VendorSearchResponse[] = [];
  const errors: unknown[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      live.push({ ...r.value, results: r.value.results.map((x) => ({ ...x, source: x.source ?? sources[i].name })) });
    } else if (r.reason instanceof HotelbedsUnavailableError) {
      // Test quota used up / access refused: drop out quietly, others still show.
      console.warn(`[hotel search] ${sources[i].name} unavailable: ${r.reason.message}`);
    } else if (!(r.reason instanceof DuffelNotEnabledError)) {
      console.error(`[hotel search] ${sources[i].name} failed`, r.reason);
      errors.push(r.reason);
    }
  });
  if (live.length === 0) {
    if (errors.length) throw errors[0];
    return mockSearch(params, "Mock data — hotel sources not enabled yet");
  }

  const byKey = new Map<string, VendorSearchResult>();
  for (const r of live.flatMap((l) => l.results)) {
    const key = `${r.title.toLowerCase().replace(/[^a-z0-9]+/g, "")}|${r.currency ?? ""}`;
    const prev = byKey.get(key);
    if (!prev || (r.price ?? Infinity) < (prev.price ?? Infinity)) byKey.set(key, r);
  }
  const results = [...byKey.values()].sort(
    (a, b) => (a.currency ?? "").localeCompare(b.currency ?? "") || (a.price ?? 0) - (b.price ?? 0),
  );
  return { status: "live", vendorLabel: live.map((l) => l.vendorLabel).join(" + "), results };
}

/**
 * Experiences from Viator and Hotelbeds Activities, merged into one list,
 * Viator first-class as before. Hotelbeds needs coordinates and a date; it
 * drops out quietly when unconfigured, out of quota or erroring.
 */
async function aggregateExperiences(params: VendorSearchParams): Promise<VendorSearchResponse> {
  if (!hotelbedsConfigured("activities")) return viatorSearch(params);
  const [viator, hotelbeds] = await Promise.allSettled([
    viatorSearch(params),
    (async () => {
      const coords = await geocodePlace(params.location ?? "");
      return coords ? hotelbedsActivitySearch(params, coords) : null;
    })(),
  ]);
  const parts: VendorSearchResponse[] = [];
  if (viator.status === "fulfilled" && viator.value.status === "live") {
    parts.push({ ...viator.value, results: viator.value.results.map((r) => ({ ...r, source: r.source ?? "Viator" })) });
  } else if (viator.status === "rejected") {
    console.error("[experience search] Viator failed", viator.reason);
  }
  if (hotelbeds.status === "fulfilled" && hotelbeds.value) parts.push(hotelbeds.value);
  else if (hotelbeds.status === "rejected") {
    const r = hotelbeds.reason;
    if (r instanceof HotelbedsUnavailableError) console.warn(`[experience search] Hotelbeds unavailable: ${r.message}`);
    else console.error("[experience search] Hotelbeds failed", r);
  }
  if (parts.length === 0) {
    if (viator.status === "rejected") throw viator.reason;
    return viator.status === "fulfilled" ? viator.value : { status: "mock", vendorLabel: "Not available", results: [] };
  }
  return {
    status: "live",
    vendorLabel: parts.map((p) => p.vendorLabel).join(" + "),
    results: parts.flatMap((p) => p.results),
    notice: parts.find((p) => p.notice)?.notice,
  };
}

function vendorLabelFor(params: VendorSearchParams): string {
  if (params.elementType === "travel") {
    return "Mock data — vendor coverage unconfirmed";
  }
  return "Mock data — partner pending";
}
