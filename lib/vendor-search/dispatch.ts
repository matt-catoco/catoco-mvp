import "server-only";
import type { VendorSearchParams, VendorSearchResponse } from "./types";
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

// One dispatch point, routing by (elementType, searchSubtype) to whichever
// vendor module actually owns that search today — never by element type
// alone. This is the architectural point of the whole build: Experiences
// routes to Viator today, but nothing stops a second Experiences subtype
// routing to a different vendor later (concert/sports ticketing needs a
// different API than activity-tour search) without touching this shape,
// only adding a case here and a new vendor module next to viator.ts.
export async function searchVendor(params: VendorSearchParams): Promise<VendorSearchResponse> {
  switch (params.elementType) {
    case "experience":
      return viatorSearch(params);

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

    // Accommodations → Duffel Stays once enabled. (Travelpayouts was ruled
    // out: its hotel data API was Hotellook's, which shut down 2025-10-20 —
    // every hotel endpoint 404s with a valid token, checked 2026-10-01.)
    case "accommodation":
      return duffelOrMock(params, "DUFFEL_STAYS_ENABLED", "Duffel Stays", duffelStaysSearch);

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

function vendorLabelFor(params: VendorSearchParams): string {
  if (params.elementType === "travel") {
    return "Mock data — vendor coverage unconfirmed";
  }
  return "Mock data — partner pending";
}
