import "server-only";

/**
 * Transactional email via Resend's REST API — separate from Supabase's own
 * SMTP config (that only handles auth emails; this is for app-triggered
 * notifications like a tied vote or an empty-options deadline). Plain fetch,
 * no SDK dependency, same style as lib/link-preview.ts.
 *
 * Requires RESEND_API_KEY (see SETUP.md — reuses the Resend account already
 * set up for Supabase SMTP, or a fresh key; either way it's a separate env
 * var this app reads directly).
 */

const FROM = "Catoco <noreply@catoco.co>";

/**
 * Staging/prod split: nothing here should ever email a real person outside
 * of production. `EMAIL_SENDING_ENABLED` is an explicit override (set it
 * per-environment in Vercel if the default below is ever wrong for a given
 * environment); absent that, only Vercel's Production environment sends for
 * real. VERCEL_ENV is unset outside Vercel entirely (local `next dev`) —
 * that keeps sending, since that's how email templates get tested locally.
 */
export function emailSendingEnabled(): boolean {
  const override = process.env.EMAIL_SENDING_ENABLED;
  if (override === "true") return true;
  if (override === "false") return false;
  return !process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production";
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ error?: string }> {
  if (!emailSendingEnabled()) {
    console.log(
      `[email suppressed, VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}] would have sent "${subject}" to ${to}`,
    );
    return {};
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { error: "RESEND_API_KEY is not set" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      return { error: `Resend responded ${res.status}` };
    }
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "email send failed" };
  }
}
