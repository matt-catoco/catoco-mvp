import "server-only";
import type { VendorSearchParams, VendorSearchResponse } from "./types";
import { mockSearch } from "./mock";
import { viatorSearch } from "./viator";

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

    // Flight (Duffel) is the right vendor but blocked on sandbox keys;
    // Rental Car/Train/Bus's actual covering vendor is unconfirmed;
    // Accommodations and Dining have no vendor picked yet. All five stay on
    // mock data — see mock.ts and the build prompt's §1 for the per-vendor
    // status. Swapping any one of these to a real call later is a single
    // case here pointing at a new module, same as Viator's.
    case "travel":
    case "accommodation":
    case "dining":
      return mockSearch(params, vendorLabelFor(params));

    default:
      return { status: "mock", vendorLabel: "Not available", results: [] };
  }
}

function vendorLabelFor(params: VendorSearchParams): string {
  if (params.elementType === "travel") {
    if (params.searchSubtype === "flight") return "Mock data — Duffel (blocked on sandbox keys)";
    return "Mock data — vendor coverage unconfirmed";
  }
  return "Mock data — partner pending";
}
