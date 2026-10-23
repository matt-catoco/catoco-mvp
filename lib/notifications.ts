import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailSendingEnabled, sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { platformFee } from "@/lib/platform-fee";
import { createServiceClient } from "@/lib/supabase/service";
import { optionTitle } from "@/components/option-summary";
import type { ElementType } from "@/lib/trip-elements";

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
  | "nudge"
  | "shares_recalculated"
  | "price_drift"
  | "deadline_missed"
  | "recommit_requested"
  | "funding_failed"
  | "refund_requested";

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
    // Service role only: prepare_notification returns the recipient's
    // unsubscribe token, so signed-in users can't call it (2026-10-17).
    const { data, error } = await createServiceClient().rpc("prepare_notification", {
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
    <p>${escapeHtml(opts.organizerName)} added you to <strong>${escapeHtml(opts.tripName)}</strong> on Catoco.</p>
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
          <p>The group's payment for <strong>${escapeHtml(elementLabel)}</strong> on <strong>${escapeHtml(trip.name)}</strong> is ready, but ${action}.</p>
          <p>Everyone else is committed and waiting for you — please sort it out by <strong>${by}</strong> or the group's booking is called off.</p>
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
          <p>${escapeHtml(who)}'s payment for <strong>${escapeHtml(elementLabel)}</strong> on <strong>${escapeHtml(trip.name)}</strong> didn't go through (${opts.reason === "authentication_required" ? "their bank needs them to confirm it" : "card declined"}).</p>
          <p>Everyone else is committed — nothing's been charged. They have until <strong>${by}</strong>; you can give them more time from the element page.</p>
          <p><a href="${url}">See where things stand</a></p>
        `,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifyPaymentRetryNeeded failed (${opts.mandateId}):`, err);
  }
}

/**
 * After someone withdrew and the shares were recalculated (by the organizer,
 * automatically after 24h, or straight away near the deadline): email each
 * person whose authorization no longer covers the new share — they have to
 * recommit (founder, 2026-10-14). People still covered aren't emailed.
 * Keyed on the cancelled authorization, so a person gets one email per
 * recalculation however many call sites fire. Pass a service-role client.
 */
export async function notifySharesRecalculated(opts: {
  supabase: SupabaseClient;
  fundingRequestId: string;
  origin: string;
}): Promise<void> {
  try {
    const { data: fr } = await opts.supabase
      .from("funding_requests")
      .select(
        "trip_id, individual_amount, platform_fee_percent, currency, funding_deadline, shares_recalculated_at, trips(name), funding_request_elements(element_id, trip_elements(label))",
      )
      .eq("id", opts.fundingRequestId)
      .maybeSingle();
    if (!fr?.shares_recalculated_at) return;
    const trip = (Array.isArray(fr.trips) ? fr.trips[0] : fr.trips) as { name: string } | null;
    const links = (fr.funding_request_elements ?? []) as {
      element_id: string;
      trip_elements: { label: string } | { label: string }[] | null;
    }[];
    const first = links[0];
    if (!trip || !first) return;
    const elementLabel =
      (Array.isArray(first.trip_elements) ? first.trip_elements[0]?.label : first.trip_elements?.label) ?? "your trip";

    // Cancelled by this recalculation (same transaction → same timestamp).
    const { data: mandates } = await opts.supabase
      .from("funding_mandates")
      .select("id, participant_id")
      .eq("funding_request_id", opts.fundingRequestId)
      .eq("status", "canceled")
      .like("failure_reason", "shares changed%")
      .gte("canceled_at", fr.shares_recalculated_at);
    if (!mandates?.length) return;

    const share = Number(fr.individual_amount);
    const total = share + platformFee(share, Number(fr.platform_fee_percent ?? 0));
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: (fr.currency as string) ?? "USD" }).format(total);
    const by = fr.funding_deadline
      ? new Date(fr.funding_deadline as string).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
      : null;
    const url = `${opts.origin}/trips/${fr.trip_id}/elements/${first.element_id}`;

    for (const m of mandates as { id: string; participant_id: string }[]) {
      const { data: email } = await opts.supabase.rpc("get_user_email", { p_user_id: m.participant_id });
      if (!email) continue;
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId: m.participant_id,
        email: email as string,
        kind: "shares_recalculated",
        subjectId: m.id,
        subject: `Please recommit to ${elementLabel} — ${trip.name}`,
        html: `
          <p>Someone withdrew from <strong>${escapeHtml(elementLabel)}</strong> on <strong>${escapeHtml(trip.name)}</strong>, so the cost has been split between fewer people.</p>
          <p>Your new share is <strong>${escapeHtml(amount)}</strong> (Catoco fee included), which is more than you authorized. Please recommit${by ? ` by <strong>${by}</strong>` : ""} to stay in. Nothing has been charged.</p>
          <p><a href="${url}">Recommit</a></p>
        `,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifySharesRecalculated failed (${opts.fundingRequestId}):`, err);
  }
}

/** A stable uuid for "this element moved to this price at this stage" —
 * notification_log dedupes per (user, kind, subject), so one email per move. */
function priceMoveSubjectId(elementId: string, stage: string, price: number): string {
  const h = createHash("md5").update(`${elementId}:${stage}:${price.toFixed(2)}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Price drift (founder, 2026-10-14; threshold 2026-10-17): the hourly
 * recheck found a vendor price that moved by more than the recommended
 * cushion (1% when the trip's cushion is off) since the organizer was last
 * told — before lock (submission / voting) or on a locked element.
 * Emails the organizer and co-organizers only. Gated by the trip's
 * notify_price_drift setting (independent of the checkout cushion) and,
 * through prepare_notification, each person's account email setting.
 * Pass a service-role client. Best-effort; never throws.
 */
export async function notifyPriceDrift(opts: {
  supabase: SupabaseClient;
  elementId: string;
  stage: "submission" | "voting" | "funding";
  oldPrice: number | null;
  newPrice: number;
  currency: string;
  basis: string | null;
  /** Funding stage: the move broke someone's authorization. */
  overCushion?: boolean;
  origin: string;
}): Promise<void> {
  try {
    const { data: el } = await opts.supabase
      .from("trip_elements")
      .select("trip_id, label, trips(name, organizer_id, notify_price_drift)")
      .eq("id", opts.elementId)
      .maybeSingle();
    if (!el) return;
    const trip = (Array.isArray(el.trips) ? el.trips[0] : el.trips) as
      | { name: string; organizer_id: string; notify_price_drift: boolean | null }
      | null;
    if (!trip) return;

    // Pre-lock: remember the price we've told them about (also when the
    // trip has emails off, so turning them on doesn't replay old moves).
    if (opts.stage !== "funding") {
      await opts.supabase.from("trip_elements").update({ last_notified_price: opts.newPrice }).eq("id", opts.elementId);
    }
    if (trip.notify_price_drift === false) return;

    const { data: coOrganizers } = await opts.supabase
      .from("trip_participants")
      .select("user_id")
      .eq("trip_id", el.trip_id)
      .eq("role", "co_organizer")
      .is("left_at", null);
    const recipients = [...new Set([trip.organizer_id, ...((coOrganizers ?? []) as { user_id: string }[]).map((c) => c.user_id)])];

    const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: opts.currency || "USD" }).format(n);
    const per = opts.basis === "per_person" ? " per person" : opts.basis === "per_night" ? " per night" : "";
    const move = opts.oldPrice != null ? `${fmt(opts.oldPrice)} → ${fmt(opts.newPrice)}${per}` : `now ${fmt(opts.newPrice)}${per}`;
    const label = escapeHtml(el.label as string);
    const tripName = escapeHtml(trip.name);
    const url = `${opts.origin}/trips/${el.trip_id}/elements/${opts.elementId}`;
    const body =
      opts.stage === "funding"
        ? opts.overCushion
          ? `<p>The price for <strong>${label}</strong> on <strong>${tripName}</strong> has gone up: <strong>${escapeHtml(move)}</strong>.</p>
           <p>That's more than some people's authorizations cover, so they've been asked to recommit at the new share. Nothing has been charged.</p>
           <p><a href="${url}">See who needs to recommit</a></p>`
          : `<p>The price for <strong>${label}</strong> on <strong>${tripName}</strong> has moved by more than the recommended cushion: <strong>${escapeHtml(move)}</strong>.</p>
           <p>Everyone's authorization still covers the new share, so nobody needs to recommit. Nothing has been charged.</p>
           <p><a href="${url}">Review the element</a></p>`
        : `<p>A price on <strong>${label}</strong> (<strong>${tripName}</strong>) has moved since it was submitted: <strong>${escapeHtml(move)}</strong>.</p>
           <p>Review it before ${opts.stage === "voting" ? "voting locks it in" : "the group votes"}.</p>
           <p><a href="${url}">Review the options</a></p>`;
    const subjectId = priceMoveSubjectId(opts.elementId, opts.stage, opts.newPrice);

    for (const userId of recipients) {
      const { data: email } = await opts.supabase.rpc("get_user_email", { p_user_id: userId });
      if (!email) continue;
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId,
        email: email as string,
        kind: "price_drift",
        subjectId,
        subject: `Price change: ${el.label} — ${trip.name}`,
        html: body,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifyPriceDrift failed (${opts.elementId}):`, err);
  }
}

/** A stable uuid for a dedupe key (notification_log subject). */
function stableUuid(key: string): string {
  const h = createHash("md5").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

type RoundInfo = {
  tripId: string;
  tripName: string;
  organizerId: string;
  elementId: string;
  elementLabel: string;
  share: number;
  missedShare: number | null;
  feePercent: number;
  currency: string;
  deadline: string | null;
  missedDeadline: string | null;
  mode: string;
};

async function loadRound(supabase: SupabaseClient, fundingRequestId: string): Promise<RoundInfo | null> {
  const { data: fr } = await supabase
    .from("funding_requests")
    .select(
      "trip_id, individual_amount, missed_share, platform_fee_percent, currency, funding_deadline, missed_deadline, collection_mode, trips(name, organizer_id), funding_request_elements(element_id, trip_elements(label))",
    )
    .eq("id", fundingRequestId)
    .maybeSingle();
  if (!fr) return null;
  const trip = (Array.isArray(fr.trips) ? fr.trips[0] : fr.trips) as { name: string; organizer_id: string } | null;
  const first = (
    (fr.funding_request_elements ?? []) as {
      element_id: string;
      trip_elements: { label: string } | { label: string }[] | null;
    }[]
  )[0];
  if (!trip || !first) return null;
  return {
    tripId: fr.trip_id as string,
    tripName: trip.name,
    organizerId: trip.organizer_id,
    elementId: first.element_id,
    elementLabel: (Array.isArray(first.trip_elements) ? first.trip_elements[0]?.label : first.trip_elements?.label) ?? "your trip",
    share: Number(fr.individual_amount),
    missedShare: fr.missed_share != null ? Number(fr.missed_share) : null,
    feePercent: Number(fr.platform_fee_percent ?? 0),
    currency: (fr.currency as string) ?? "EUR",
    deadline: fr.funding_deadline as string | null,
    missedDeadline: fr.missed_deadline as string | null,
    mode: fr.collection_mode as string,
  };
}

const utcDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/**
 * Deadline missed, step 1 (founder, 2026-10-22): the round closed without
 * everyone in, so commitments / unpaid pledges were released. The organizer
 * and co-organizers choose what happens next; the group hears nothing until
 * a new deadline is set (notifyRecommitRequested). Service-role client.
 * Best-effort; never throws.
 */
export async function notifyDeadlineMissed(opts: {
  supabase: SupabaseClient;
  fundingRequestId: string;
  inCount: number;
  population: number;
  origin: string;
}): Promise<void> {
  try {
    const r = await loadRound(opts.supabase, opts.fundingRequestId);
    if (!r) return;
    const { data: coOrganizers } = await opts.supabase
      .from("trip_participants")
      .select("user_id")
      .eq("trip_id", r.tripId)
      .eq("role", "co_organizer")
      .is("left_at", null);
    const recipients = [...new Set([r.organizerId, ...((coOrganizers ?? []) as { user_id: string }[]).map((c) => c.user_id)])];
    const pledge = r.mode === "peer_pledge";
    const label = escapeHtml(r.elementLabel);
    const tripName = escapeHtml(r.tripName);
    const url = `${opts.origin}/trips/${r.tripId}/elements/${r.elementId}`;
    const when = r.missedDeadline ? ` on ${escapeHtml(utcDate(r.missedDeadline))}` : "";
    const html = `
      <p>The ${pledge ? "pledge" : "funding"} deadline for <strong>${label}</strong> on <strong>${tripName}</strong> passed${when} with ${opts.inCount} of ${opts.population} people in.</p>
      <p>${pledge ? "The unpaid pledges have been released." : "Nobody was charged, and everyone&#39;s commitment has been released."} Nothing goes to the group until you decide what&#39;s next:</p>
      <ol>
        <li>Check the price is still right, and update it if it has changed.</li>
        <li>Set a new deadline. We&#39;ll then email everyone to ${pledge ? "pledge again" : "recommit"}, with the new date and their share.</li>
      </ol>
      <p>If it&#39;s no longer available, choose <strong>No longer available</strong> on the element page: it switches to the vote&#39;s runner-up, or reopens the element for new options if there isn&#39;t one. We&#39;ll email the group either way.</p>
      <p><a href="${url}">Decide what&#39;s next</a></p>
    `;
    const subjectId = stableUuid(`deadline_missed:${opts.fundingRequestId}:${r.missedDeadline ?? ""}`);
    for (const userId of recipients) {
      const { data: email } = await opts.supabase.rpc("get_user_email", { p_user_id: userId });
      if (!email) continue;
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId,
        email: email as string,
        kind: "deadline_missed",
        subjectId,
        subject: `Deadline passed: ${r.elementLabel} needs a decision — ${r.tripName}`,
        html,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifyDeadlineMissed failed (${opts.fundingRequestId}):`, err);
  }
}

/**
 * Deadline missed, step 2: the organizer set a new deadline. Everyone in
 * the element (bar whoever set it) is asked to recommit / pledge again,
 * with the new date and their share — and the old share if it moved.
 * Service-role client. Best-effort; never throws.
 */
export async function notifyRecommitRequested(opts: {
  supabase: SupabaseClient;
  fundingRequestId: string;
  actorId: string;
  origin: string;
}): Promise<void> {
  try {
    const r = await loadRound(opts.supabase, opts.fundingRequestId);
    if (!r || !r.deadline) return;
    const recipients = (await roundParticipants(opts.supabase, opts.fundingRequestId)).filter((id) => id !== opts.actorId);

    const pledge = r.mode === "peer_pledge";
    const withFee = (n: number) => n + (pledge ? 0 : platformFee(n, r.feePercent));
    const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: r.currency }).format(withFee(n));
    const changed = r.missedShare != null && Math.abs(r.missedShare - r.share) >= 0.01;
    const label = escapeHtml(r.elementLabel);
    const tripName = escapeHtml(r.tripName);
    const url = `${opts.origin}/trips/${r.tripId}/elements/${r.elementId}`;
    const shareLine = changed
      ? `Your share is now <strong>${escapeHtml(money(r.share))}</strong> (it was ${escapeHtml(money(r.missedShare!))}).`
      : `Your share is <strong>${escapeHtml(money(r.share))}</strong>.`;
    const html = `
      <p>Not everyone was in by the last deadline for <strong>${label}</strong> on <strong>${tripName}</strong>, so ${pledge ? "the pledges were released" : "nobody was charged and every commitment was released"}.</p>
      <p>There&#39;s a new deadline: <strong>${escapeHtml(utcDate(r.deadline))}</strong>. ${shareLine}${pledge ? "" : " Catoco fee included."}</p>
      <p>Please ${pledge ? "pledge again" : "recommit"} by then to stay in.</p>
      <p><a href="${url}">${pledge ? "Pledge again" : "Recommit"}</a></p>
    `;
    const subjectId = stableUuid(`recommit:${opts.fundingRequestId}:${r.deadline}`);
    for (const userId of recipients) {
      const { data: email } = await opts.supabase.rpc("get_user_email", { p_user_id: userId });
      if (!email) continue;
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId,
        email: email as string,
        kind: "recommit_requested",
        subjectId,
        subject: `New deadline: please ${pledge ? "pledge again" : "recommit"} for ${r.elementLabel} — ${r.tripName}`,
        html,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifyRecommitRequested failed (${opts.fundingRequestId}):`, err);
  }
}

/** The hourly job: record rounds that just missed their deadline and tell the organizers. */
export async function handleMissedDeadlines(origin: string): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("mark_missed_funding_deadlines");
  if (error) {
    console.error("mark_missed_funding_deadlines failed:", error.message);
    return 0;
  }
  const rows = (data ?? []) as { funding_request_id: string; in_count: number; population: number }[];
  for (const row of rows) {
    await notifyDeadlineMissed({
      supabase,
      fundingRequestId: row.funding_request_id,
      inCount: row.in_count,
      population: row.population,
      origin,
    });
  }
  return rows.length;
}

/** Everyone in a round (opted in on any of its elements). Read before it's called off. */
export async function roundParticipants(supabase: SupabaseClient, fundingRequestId: string): Promise<string[]> {
  const { data: links } = await supabase
    .from("funding_request_elements")
    .select("element_id")
    .eq("funding_request_id", fundingRequestId);
  const { data: people } = await supabase
    .from("element_participants")
    .select("participant_id")
    .in("element_id", ((links ?? []) as { element_id: string }[]).map((l) => l.element_id))
    .eq("opted_in", true);
  return [...new Set(((people ?? []) as { participant_id: string }[]).map((p) => p.participant_id))];
}

/**
 * Deadline missed, other branch (founder, 2026-10-22): the organizer resolved
 * the round as not viable, so this choice is called off. The group is told,
 * with what happens next: the runner-up option becomes the pick (and gets
 * its own funding round), or the element reopens for new ideas.
 * `recipients` are read before the call-off. Service-role client.
 * Best-effort; never throws.
 */
export async function notifyRoundCalledOff(opts: {
  supabase: SupabaseClient;
  fundingRequestId: string;
  recipients: string[];
  actorId: string;
  origin: string;
}): Promise<void> {
  try {
    const r = await loadRound(opts.supabase, opts.fundingRequestId);
    if (!r) return;
    const { data: el } = await opts.supabase.from("trip_elements").select("state, locked_option_id").eq("id", r.elementId).maybeSingle();
    const runnerUp = Boolean(el?.locked_option_id) && el?.state !== "open";
    let runnerUpTitle: string | null = null;
    if (runnerUp) {
      const { data: opt } = await opts.supabase
        .from("element_options")
        .select("value, trip_elements!inner(type)")
        .eq("id", el!.locked_option_id as string)
        .maybeSingle();
      const type = opt ? ((Array.isArray(opt.trip_elements) ? opt.trip_elements[0] : opt.trip_elements) as { type: string } | null)?.type : null;
      if (opt && type) runnerUpTitle = optionTitle(type as ElementType, (opt.value ?? {}) as Record<string, unknown>) || null;
    }
    const pledge = r.mode === "peer_pledge";
    const label = escapeHtml(r.elementLabel);
    const tripName = escapeHtml(r.tripName);
    const url = `${opts.origin}/trips/${r.tripId}/elements/${r.elementId}`;
    const html = `
      <p>The organizer has marked the current choice for <strong>${label}</strong> on <strong>${tripName}</strong> as no longer available, after not everyone was in by the deadline.</p>
      <p>${pledge ? "Your pledge no longer applies, and nobody needs to pay anything for it." : "Nobody was charged, and your commitment no longer applies."}</p>
      <p>${
        runnerUp
          ? `The runner-up from your vote${runnerUpTitle ? `, <strong>${escapeHtml(runnerUpTitle)}</strong>,` : ""} is now the pick, with its own deadline and price. Take a look and ${pledge ? "pledge" : "commit"} if you&#39;re in.`
          : "The element is open again, so the group can add and vote on new options."
      }</p>
      <p><a href="${url}">See what&#39;s next</a></p>
    `;
    const subjectId = stableUuid(`called_off:${opts.fundingRequestId}`);
    for (const userId of opts.recipients.filter((id) => id !== opts.actorId)) {
      const { data: email } = await opts.supabase.rpc("get_user_email", { p_user_id: userId });
      if (!email) continue;
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId,
        email: email as string,
        kind: "funding_failed",
        subjectId,
        subject: runnerUp
          ? `Switched to the runner-up: ${r.elementLabel} — ${r.tripName}`
          : `No longer available: ${r.elementLabel} — ${r.tripName}`,
        html,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifyRoundCalledOff failed (${opts.fundingRequestId}):`, err);
  }
}

/**
 * A member who had paid was pushed above their price cushion and asked for
 * their money back (founder, 2026-10-22). Tells the person holding the money
 * (the purchaser) and the organizer. Service-role client. Best-effort.
 */
export async function notifyRefundRequested(opts: {
  supabase: SupabaseClient;
  fundingRequestId: string;
  requesterId: string;
  amount: number;
  origin: string;
}): Promise<void> {
  try {
    const r = await loadRound(opts.supabase, opts.fundingRequestId);
    if (!r) return;
    const [{ data: fr }, { data: who }] = await Promise.all([
      opts.supabase.from("funding_requests").select("purchaser_id").eq("id", opts.fundingRequestId).maybeSingle(),
      opts.supabase.from("profiles").select("display_name").eq("id", opts.requesterId).maybeSingle(),
    ]);
    const name = escapeHtml((who as { display_name?: string } | null)?.display_name?.trim() || "A member");
    const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: r.currency }).format(opts.amount);
    const url = `${opts.origin}/trips/${r.tripId}/elements/${r.elementId}`;
    const recipients = [...new Set([fr?.purchaser_id as string | null, r.organizerId].filter((x): x is string => Boolean(x)))];
    for (const userId of recipients) {
      const { data: email } = await opts.supabase.rpc("get_user_email", { p_user_id: userId });
      if (!email) continue;
      await sendCoreLoopEmail({
        supabase: opts.supabase,
        userId,
        email: email as string,
        kind: "refund_requested",
        subjectId: stableUuid(`refund:${opts.fundingRequestId}:${opts.requesterId}:${opts.amount}`),
        subject: `Refund requested: ${r.elementLabel} — ${r.tripName}`,
        html: `
          <p>${name} has asked for a refund of <strong>${escapeHtml(money)}</strong> for <strong>${escapeHtml(r.elementLabel)}</strong> on <strong>${escapeHtml(r.tripName)}</strong>. The price went above their cushion, so they&#39;ve left this element.</p>
          <p>Refund them the same way they paid you, then mark it as refunded on the element page.</p>
          <p><a href="${url}">Open the element</a></p>
        `,
        origin: opts.origin,
      });
    }
  } catch (err) {
    console.error(`notifyRefundRequested failed (${opts.fundingRequestId}):`, err);
  }
}
