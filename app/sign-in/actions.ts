"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/allowlist";

export type RequestMagicLinkResult = { error?: string };

/**
 * Beta-access gate: checks the allowlist server-side before ever asking
 * Supabase to send a magic link, rather than letting the client call
 * signInWithOtp directly (the previous flow) -- the anon key is public in
 * the browser bundle regardless, so this needs to be enforced here, not
 * just hidden in the sign-in page's own UI.
 */
export async function requestMagicLink(
  email: string,
  tripId: string | null,
  next: string,
): Promise<RequestMagicLinkResult> {
  if (!isAllowedEmail(email)) {
    return { error: "Catoco is invite-only right now. Reach out to hello@catoco.co for access." };
  }

  const h = await headers();
  const host = h.get("host");
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  const origin = host ? `${proto}://${host}` : "https://catoco.co";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      // Read by the handle_new_user() DB trigger. Supabase only applies this
      // when a brand-new user is created, so re-invites don't overwrite it.
      data: tripId ? { invited_via_trip_id: tripId } : undefined,
    },
  });

  if (error) return { error: error.message };
  return {};
}
