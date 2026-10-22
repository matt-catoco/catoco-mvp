import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { providerForOption } from "@/lib/providers";
import { bookingRouteFor, outboundUrl, subIdFor } from "@/lib/booking-route";

/**
 * Outbound booking link (three-prong Prompt 1 §6). Logs the click, adds our
 * sub-ID to partner links, and redirects to the element's OWN locked option
 * link — never to a URL taken from the request, so this can't be used as an
 * open redirect. Members of the trip only (RLS on the reads below).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ elementId: string }> }) {
  const { elementId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));

  const { data: el } = await supabase
    .from("trip_elements")
    .select("id, trip_id, locked_option_id")
    .eq("id", elementId)
    .maybeSingle();
  if (!el?.locked_option_id) return NextResponse.redirect(new URL("/trips", request.url));

  const [{ data: option }, { data: fre }] = await Promise.all([
    supabase.from("element_options").select("value").eq("id", el.locked_option_id).maybeSingle(),
    supabase
      .from("funding_request_elements")
      .select("funding_request_id, funding_requests!inner(status)")
      .eq("element_id", elementId)
      .neq("funding_requests.status", "superseded")
      .limit(1)
      .maybeSingle(),
  ]);
  const value = (option?.value ?? {}) as Record<string, unknown>;
  const route = bookingRouteFor(value);
  const fundingRequestId = (fre?.funding_request_id as string | undefined) ?? null;
  const subId = subIdFor(fundingRequestId, elementId);
  const target = outboundUrl(value, subId);
  const back = new URL(`/trips/${el.trip_id}/elements/${elementId}`, request.url);
  if (!target || !route) return NextResponse.redirect(back);

  // Best-effort: a failed log never blocks the person from booking.
  try {
    await createServiceClient().from("outbound_clicks").insert({
      user_id: user.id,
      trip_id: el.trip_id,
      element_id: elementId,
      funding_request_id: fundingRequestId,
      provider: providerForOption(value),
      route,
      sub_id: subId,
    });
  } catch (err) {
    console.error("[out] click log failed", err);
  }
  return NextResponse.redirect(target, 302);
}
