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

export function isAllowedEmail(email: string): boolean {
  return ALLOWED_EMAILS.has(email.trim().toLowerCase());
}
