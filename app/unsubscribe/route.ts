import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * One-click unsubscribe — plain GET, no auth required (that's the point: it
 * has to work straight from an email link with no session). The token in the
 * link is the authority, not a cookie. Wrong/missing token fails closed —
 * no change, a generic "link didn't work" message, never an error page.
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("u");
  const token = request.nextUrl.searchParams.get("t");

  let ok = false;
  if (userId && token) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("unsubscribe_by_token", {
      p_user_id: userId,
      p_token: token,
    });
    ok = !error && data === true;
  }

  const html = ok
    ? `<p>You won't get trip email reminders anymore. You can still use Catoco normally.</p>`
    : `<p>That link didn't work. If you're still getting emails you don't want, reach out to hello@catoco.co.</p>`;

  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Catoco</title>
      <style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#0d2020;background:#fafaf7;}</style>
      </head><body>${html}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
