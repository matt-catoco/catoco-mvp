import { NextRequest, NextResponse } from "next/server";
import { searchVendor } from "@/lib/vendor-search/dispatch";
import type { VendorSearchParams, VendorSearchResponse } from "@/lib/vendor-search/types";

/**
 * Single dispatch endpoint for every vendor search scene (Travel's four
 * subtypes, Accommodations, Experiences, Dining) — keeps every vendor's API
 * key server-only regardless of which one ends up handling a given request.
 * Destination isn't here; it's still /api/geocode (Mapbox), unchanged by
 * this build.
 */
export async function POST(request: NextRequest) {
  let params: VendorSearchParams;
  try {
    params = (await request.json()) as VendorSearchParams;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!params.elementType) {
    return NextResponse.json({ error: "elementType is required" }, { status: 400 });
  }

  try {
    const result = await searchVendor(params);
    return NextResponse.json(result satisfies VendorSearchResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Vendor search failed" },
      { status: 502 },
    );
  }
}
