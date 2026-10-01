import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Small static map image for an option card (Mapbox Static Images API).
 * Proxied rather than linked directly so MAPBOX_TOKEN stays server-only —
 * same reasoning as app/api/geocode — and gated to signed-in users so this
 * isn't an open, quota-burning image proxy. Coordinates are clamped and
 * rounded (≈100 m), which also makes identical pins cache-friendly.
 */
export async function GET(request: NextRequest) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Math.min(16, Math.max(1, Math.round(Number(params.get("z") ?? 12))));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
    return new NextResponse(null, { status: 400 });
  }
  const la = lat.toFixed(3);
  const ln = lng.toFixed(3);

  const url =
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
    `pin-s+0f766e(${ln},${la})/${ln},${la},${zoom},0/160x160@2x` +
    // Mapbox's default logo/attribution stay on — their terms require it.
    `?access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return new NextResponse(null, { status: 502 });
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        // Private: the route is auth-gated; a day is plenty for a map pin.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
