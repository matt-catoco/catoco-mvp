import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";

// Cross-cutting: needs to be importable from a server action (page-load
// invite trigger, funding-resolve trigger) and the cron route handler alike,
// so it can't live under app/trips/[tripId]/ like notify.ts does.

export type NotificationKind =
  | "invited"
  | "funding_ready"
  | "vote_needed"
  | "funding_needed"
  | "funding_deadline_set";

/**
 * The one send path for all four core-loop triggers. Checks eligibility
 * (opted in, not already sent for this exact user+kind+subject) and claims
 * it atomically via prepare_notification() -- a security-definer RPC, not a
 * direct table read/write, since trigger #2 notifies a different user than
 * whoever is acting (the organizer resolving funding on behalf of the
 * purchaser), which a plain RLS-scoped client write can't do safely. Appends
 * the unsubscribe footer and sends via lib/email.ts's existing Resend
 * integration. Best-effort throughout: a failure here should never throw
 * past the caller's own action succeeding.
 */
export async function sendCoreLoopEmail(opts: {
  supabase: SupabaseClient;
  userId: string;
  email: string;
  kind: NotificationKind;
  subjectId: string;
  subject: string;
  html: string;
  origin: string;
}): Promise<void> {
  try {
    const { data, error } = await opts.supabase.rpc("prepare_notification", {
      p_user_id: opts.userId,
      p_kind: opts.kind,
      p_subject_id: opts.subjectId,
    });
    if (error) {
      console.error(`prepare_notification failed (${opts.kind}/${opts.subjectId}):`, error.message);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { should_send: boolean; unsubscribe_token: string | null }
      | undefined;
    if (!row?.should_send || !row.unsubscribe_token) return;

    const footer = `<p style="margin-top:24px;font-size:12px;color:#6b6b64;">
      <a href="${opts.origin}/unsubscribe?u=${opts.userId}&t=${row.unsubscribe_token}">Unsubscribe from trip email reminders</a>
    </p>`;

    const res = await sendEmail({ to: opts.email, subject: opts.subject, html: opts.html + footer });
    if (res.error) {
      console.error(`sendEmail failed (${opts.kind}/${opts.subjectId}):`, res.error);
    }
  } catch (err) {
    console.error(`sendCoreLoopEmail threw (${opts.kind}/${opts.subjectId}):`, err);
  }
}

/**
 * Trigger #1 (invited to trip) — shared between the two call sites
 * (app/trips/[tripId]/page.tsx, app/trips/[tripId]/elements/[elementId]/
 * page.tsx), both of which call join_trip() on every load and now get a
 * boolean back signaling a genuinely new join. The newly-joined user's own
 * id/email are already on hand from that page's own auth.getUser() call --
 * no extra lookup needed for the recipient, just the trip name and
 * organizer's display name for the copy.
 */
export async function notifyInvited(opts: {
  supabase: SupabaseClient;
  tripId: string;
  tripName: string;
  organizerName: string;
  userId: string;
  userEmail: string;
  origin: string;
}): Promise<void> {
  const subject = `You're in — welcome to ${opts.tripName}`;
  const html = `
    <p>${opts.organizerName} added you to <strong>${opts.tripName}</strong> on Catoco.</p>
    <p><a href="${opts.origin}/trips/${opts.tripId}">Take a look</a></p>
  `;
  await sendCoreLoopEmail({
    supabase: opts.supabase,
    userId: opts.userId,
    email: opts.userEmail,
    kind: "invited",
    subjectId: opts.tripId,
    subject,
    html,
    origin: opts.origin,
  });
}
