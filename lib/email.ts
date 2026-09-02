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

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ error?: string }> {
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
