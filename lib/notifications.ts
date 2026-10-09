import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailSendingEnabled, sendEmail } from "@/lib/email";

// Cross-cutting: needs to be importable from a server action (page-load
// invite trigger, funding-resolve trigger) and the cron route handler alike,
// so it can't live under app/trips/[tripId]/ like notify.ts does.

export type NotificationKind =
  | "invited"
  | "funding_ready"
  | "vote_needed"
  | "funding_needed"
  | "funding_deadline_set"
  | "payment_retry_needed"
  | "nudge";

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
  // Check before prepare_notification, not after — that RPC atomically
  // claims the notification_log row for this user+kind+subject, so calling
  // it while suppressed would mark a never-sent email as sent and block a
  // real send later if sending gets turned back on for this environment.
  if (!emailSendingEnabled()) {
    console.log(
      `[email suppressed, VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}] would have sent ${opts.kind}/${opts.subjectId} to ${opts.email}`,
    );
    return;
  }
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

/**
 * Flow #4 retry buffer: a card hold failed at the funding deadline. Emails
 * the participant (what they need to do, by when) and the organizer (who's
 * holding the pool up). Everyone else's hold is untouched meanwhile.
 * Called once per entry into awaiting_retry (mark_mandate_awaiting_retry's
 * newly_awaiting), and prepare_notification dedupes per mandate anyway.
 */
export async function notifyPaymentRetryNeeded(opts: {
  supabase: SupabaseClient;
  mandateId: string;
  reason: "payment_method_failed" | "authentication_required";
  retryDeadline: string | null;
  origin: string;
}): Promise<void> {
  try {
    const { data: m } = await opts.supabase
      .from("funding_mandates")
      .select("participant_id, individual_amount, currency, funding_request_id")
      .eq("id", opts.mandateId)
      .maybeSingle();
    if (!m) return;
    const { data: fr } = await opts.supabase
      .from("funding_requests")
      .select("trip_id, trips(name, organizer_id), funding_request_elements(element_id, trip_elements(label))")
      .eq("id", m.funding_request_id)
      .maybeSingle();
    if (!fr) return;
    const trip = (Array.isArray(fr.trips) ? fr.trips[0] : fr.trips) as { name: string; organizer_id: string } | null;
    const links = (fr.funding_request_elements ?? []) as {
      element_id: string;
      trip_elements: { label: string } | { label: string }[] | null;
    }[];
    const first = links[0];
    const elementLabel =
      (Array.isArray(first?.trip_elements) ? first?.trip_elements[0]?.label : first?.trip_elements?.label) ?? "your trip";
    if (!trip || !first) return;

    const url = `${opts.origin}/trips/${fr.trip_id}/elements/${first.element_id}`;
    const by = opts.retryDeadline
      ? new Date(opts.retryDeadline).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
      : "soon";
    const action =
      opts.reason === "authentication_required"
        ? "your bank needs you to confirm the payment"
        : "your card was declined — add a new payment method";

    const [{ data: participantEmail }, { data: organizerEmail }, { data: participantProfile }] = await Promise.all([
      opts.supabase.rpc("get_user_email", { p_user_id: m.participant_id }),
      opts.supabase.rpc("get_user_email", { p_user_id: trip.organizer_id }),
      opts.supabase.from("profiles").select("display_name").eq("id", m.participant_id).maybeSingle(),
    ]);

    if (participantEmail) {
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId: m.participant_id,
        email: participantEmail as string,
        kind: "payment_retry_needed",
        subjectId: opts.mandateId,
        subject: `Action needed for ${elementLabel} — ${trip.name}`,
        html: `
          <p>The group's payment for <strong>${elementLabel}</strong> on <strong>${trip.name}</strong> is ready, but ${action}.</p>
          <p>Everyone else's payment is on hold, waiting for you — please sort it out by <strong>${by}</strong> or the group's booking is called off.</p>
          <p><a href="${url}">${opts.reason === "authentication_required" ? "Confirm the payment" : "Update payment method"}</a></p>
        `,
        origin: opts.origin,
      });
    }
    if (organizerEmail && trip.organizer_id !== m.participant_id) {
      const who = (participantProfile?.display_name as string | null)?.trim() || "One participant";
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId: trip.organizer_id,
        email: organizerEmail as string,
        kind: "payment_retry_needed",
        subjectId: opts.mandateId,
        subject: `${elementLabel}: waiting on one payment — ${trip.name}`,
        html: `
          <p>${who}'s payment for <strong>${elementLabel}</strong> on <strong>${trip.name}</strong> didn't go through (${opts.reason === "authentication_required" ? "their bank needs them to confirm it" : "card declined"}).</p>
          <p>Everyone else's payment is on hold — nothing's been charged. They have until <strong>${by}</strong>; you can give them more time from the element page.</p>
          <p><a href="${url}">See where things stand</a></p>
        `,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifyPaymentRetryNeeded failed (${opts.mandateId}):`, err);
  }
}
