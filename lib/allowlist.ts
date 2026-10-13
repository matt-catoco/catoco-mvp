import type { SupabaseClient } from "@supabase/supabase-js";

// Beta-access gate (2026-09-xx) -- pre-launch, invite-only. Catoco is
// publicly reachable and the sign-in flow was open to anyone who found it,
// letting a random visitor create real trips against production data.
// DB-backed since 2026-10-11 (public.beta_allowlist, seeded from the old
// hardcoded list): an organizer/co-organizer sending an invite by email from
// Participants grants that email access (send_trip_invite). Checked
// server-side (app/sign-in/actions.ts) via is_email_allowlisted(), not just
// hidden in the UI, since the Supabase anon key is public in the browser
// bundle regardless of what the sign-in page itself does.

/**
 * Staging/prod split: gated behind ALLOWLIST_ENABLED so it can be turned off
 * per-environment (Vercel env var) instead of a code change — e.g. staging,
 * while the founder is its only tester, has no need to gate sign-in at all.
 * Defaults to enabled when unset. Fails closed if the lookup errors.
 */
export async function isAllowedEmail(supabase: SupabaseClient, email: string): Promise<boolean> {
  if (process.env.ALLOWLIST_ENABLED === "false") return true;
  const { data, error } = await supabase.rpc("is_email_allowlisted", { p_email: email });
  if (error) {
    console.error("is_email_allowlisted failed:", error.message);
    return false; // fail closed — beta gate, not a feature
  }
  return Boolean(data);
}
