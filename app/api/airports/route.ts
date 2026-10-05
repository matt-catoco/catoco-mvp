import { NextRequest, NextResponse } from "next/server";
import { airportSuggestions, type AirportSuggestion } from "@/lib/vendor-search/airports";

/**
 * City/airport suggestions for the flight search From/To boxes
 * (components/airport-picker.tsx). Server-side so the Duffel and Mapbox
 * keys stay server-only, same as /api/geocode and /api/vendor-search.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  try {
    return NextResponse.json({ results: await airportSuggestions(q) });
  } catch {
    return NextResponse.json({ results: [] as AirportSuggestion[] });
  }
}
