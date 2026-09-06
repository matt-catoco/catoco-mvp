// Beta-access gate (2026-09-xx) -- pre-launch, invite-only. Catoco is
// publicly reachable and the sign-in flow was open to anyone who found it,
// letting a random visitor create real trips against production data.
// Flat allowlist, not a DB table: small, founder-managed, expected to grow
// slowly during the beta -- add an email here and redeploy when a new
// tester needs access. Checked server-side (app/sign-in/actions.ts), not
// just hidden in the UI, since the Supabase anon key is public in the
// browser bundle regardless of what the sign-in page itself does.
const ALLOWED_EMAILS = new Set(
  [
    "mksavit@gmail.com",
    "matt@catoco.co",
    "hello@catoco.co",
    "matt+t1@catoco.co",
    "matt+t2@catoco.co",
    "matt+t3@catoco.co",
    "matt+t4@catoco.co",
    "matt+t5@catoco.co",
    "matt+t6@catoco.co",
    "matt+t7@catoco.co",
  ].map((e) => e.toLowerCase()),
);

/**
 * Staging/prod split: gated behind ALLOWLIST_ENABLED so it can be turned off
 * per-environment (Vercel env var) instead of a code change — e.g. staging,
 * while the founder is its only tester, has no need to gate sign-in at all.
 * Defaults to enabled (current behavior) when unset, so production stays
 * exactly as it is today without needing to explicitly opt in.
 */
export function isAllowedEmail(email: string): boolean {
  if (process.env.ALLOWLIST_ENABLED === "false") return true;
  return ALLOWED_EMAILS.has(email.trim().toLowerCase());
}
