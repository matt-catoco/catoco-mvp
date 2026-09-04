import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendCoreLoopEmail } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Once-daily cron, so true 24h precision isn't achievable without hourly
// runs. Lookahead window instead: on each run, anything whose deadline is
// more than 0 and at most 48h away, hasn't already passed, and has no
// matching notification_log row yet. Since runs are 24h apart, the first
// run to see a given deadline enter this window typically lands somewhere
// between 24-48h out -- a reasonable, honest approximation of "~24h out,
// once" given daily granularity, not exact precision. Tighten the cron
// schedule (vercel.json) if closer timing matters later.
const LOOKAHEAD_HOURS = 48;

type ElementRow = {
  id: string;
  trip_id: string;
  label: string;
  options_deadline: string | null;
  voting_deadline: string | null;
  trips: { name: string } | { name: string }[] | null;
};

type FundingRow = {
  id: string;
  trip_id: string;
  required_amount: number;
  funding_deadline: string | null;
};

function tripName(row: ElementRow): string {
  const t = Array.isArray(row.trips) ? row.trips[0] : row.trips;
  return t?.name ?? "your trip";
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const windowEndIso = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000).toISOString();
  const origin = request.nextUrl.origin;

  // ---- gather every candidate recipient across both triggers first, so
  // emails can be looked up in one batched call instead of N round trips ----
  const pending: {
    userId: string;
    kind: "vote_needed" | "funding_needed";
    subjectId: string;
    subject: string;
    html: string;
  }[] = [];

  // ---- Trigger #3a: options (submission) deadline approaching -------------
  const { data: optionsDue } = await supabase
    .from("trip_elements")
    .select("id, trip_id, label, options_deadline, voting_deadline, trips(name)")
    .eq("state", "open")
    .gte("options_deadline", nowIso)
    .lte("options_deadline", windowEndIso)
    .returns<ElementRow[]>();

  for (const el of optionsDue ?? []) {
    const [{ data: participants }, { data: proposed }] = await Promise.all([
      supabase
        .from("element_participants")
        .select("participant_id")
        .eq("element_id", el.id)
        .eq("opted_in", true),
      supabase.from("element_options").select("proposed_by").eq("element_id", el.id),
    ]);
    const alreadyProposed = new Set((proposed ?? []).map((p) => p.proposed_by).filter(Boolean));
    const recipients = (participants ?? [])
      .map((p) => p.participant_id)
      .filter((uid) => !alreadyProposed.has(uid));

    const trip = tripName(el);
    const deadline = el.options_deadline!.slice(0, 10);
    for (const userId of recipients) {
      pending.push({
        userId,
        kind: "vote_needed",
        subjectId: el.id,
        subject: `Add an option for ${el.label} — ${trip}`,
        html: `
          <p><strong>${el.label}</strong> on <strong>${trip}</strong> needs option submissions by ${deadline} — nobody's proposed anything for you to vote on yet.</p>
          <p><a href="${origin}/trips/${el.trip_id}/elements/${el.id}">Propose one</a></p>
        `,
      });
    }
  }

  // ---- Trigger #3b: voting deadline approaching ----------------------------
  const { data: votingDue } = await supabase
    .from("trip_elements")
    .select("id, trip_id, label, options_deadline, voting_deadline, trips(name)")
    .eq("state", "open")
    .gte("voting_deadline", nowIso)
    .lte("voting_deadline", windowEndIso)
    .returns<ElementRow[]>();

  for (const el of votingDue ?? []) {
    const { data: options } = await supabase
      .from("element_options")
      .select("id")
      .eq("element_id", el.id);
    const optionIds = (options ?? []).map((o) => o.id);
    // Nothing to vote on at all -- "vote needed" doesn't make sense here;
    // that case is already covered separately by resolve_due_elements'
    // existing empty-options organizer notification.
    if (optionIds.length === 0) continue;

    const [{ data: participants }, { data: votes }] = await Promise.all([
      supabase
        .from("element_participants")
        .select("participant_id")
        .eq("element_id", el.id)
        .eq("opted_in", true),
      supabase.from("votes").select("participant_id").in("option_id", optionIds),
    ]);
    const alreadyVoted = new Set((votes ?? []).map((v) => v.participant_id));
    const recipients = (participants ?? [])
      .map((p) => p.participant_id)
      .filter((uid) => !alreadyVoted.has(uid));

    const trip = tripName(el);
    const deadline = el.voting_deadline!.slice(0, 10);
    for (const userId of recipients) {
      pending.push({
        userId,
        kind: "vote_needed",
        subjectId: el.id,
        subject: `Vote on ${el.label} — ${trip}`,
        html: `
          <p>Voting closes for <strong>${el.label}</strong> on <strong>${trip}</strong> on ${deadline} — you haven't ranked the options yet.</p>
          <p><a href="${origin}/trips/${el.trip_id}/elements/${el.id}">Vote now</a></p>
        `,
      });
    }
  }

  // ---- Trigger #4: funding deadline approaching ----------------------------
  const { data: fundingDue } = await supabase
    .from("funding_requests")
    .select("id, trip_id, required_amount, funding_deadline")
    .eq("status", "collecting")
    .gte("funding_deadline", nowIso)
    .lte("funding_deadline", windowEndIso)
    .returns<FundingRow[]>();

  for (const fr of fundingDue ?? []) {
    const [{ data: linkRows }, { data: contributions }, { data: trip }] = await Promise.all([
      supabase.from("funding_request_elements").select("element_id").eq("funding_request_id", fr.id),
      supabase.from("funding_contributions").select("contributor_id, amount").eq("funding_request_id", fr.id),
      supabase.from("trips").select("name").eq("id", fr.trip_id).maybeSingle(),
    ]);
    const elementIds = (linkRows ?? []).map((r) => r.element_id);
    if (elementIds.length === 0) continue;

    const { data: elements } = await supabase
      .from("trip_elements")
      .select("id, label")
      .in("id", elementIds);
    const primaryElement = elements?.[0]; // bundled requests span several elements; name after the first
    if (!primaryElement) continue;

    const { data: participants } = await supabase
      .from("element_participants")
      .select("participant_id")
      .in("element_id", elementIds)
      .eq("opted_in", true);

    const alreadyContributed = new Set((contributions ?? []).map((c) => c.contributor_id));
    const collected = (contributions ?? []).reduce((sum, c) => sum + c.amount, 0);
    const stillNeeded = Math.max(0, fr.required_amount - collected);

    const recipients = new Set(
      (participants ?? [])
        .map((p) => p.participant_id)
        .filter((uid) => !alreadyContributed.has(uid)),
    );

    const tripLabel = trip?.name ?? "your trip";
    const deadline = fr.funding_deadline!.slice(0, 10);
    for (const userId of recipients) {
      pending.push({
        userId,
        kind: "funding_needed",
        subjectId: fr.id,
        subject: `${primaryElement.label} needs ${stillNeeded.toFixed(2)} more — ${tripLabel}`,
        html: `
          <p><strong>${primaryElement.label}</strong> on <strong>${tripLabel}</strong> still needs ${stillNeeded.toFixed(2)} by ${deadline} to hit its funding goal.</p>
          <p><a href="${origin}/trips/${fr.trip_id}/elements/${primaryElement.id}">Contribute</a></p>
        `,
      });
    }
  }

  // ---- resolve emails in one batch, then send (prepare_notification still
  // gates each individual send on opt-out + not-already-logged) ----
  const uniqueUserIds = [...new Set(pending.map((p) => p.userId))];
  const emailByUser = new Map<string, string>();
  if (uniqueUserIds.length > 0) {
    const { data: emailRows } = await supabase.rpc("get_user_emails", { p_user_ids: uniqueUserIds });
    for (const row of (emailRows ?? []) as { user_id: string; email: string }[]) {
      emailByUser.set(row.user_id, row.email);
    }
  }

  let sent = 0;
  for (const item of pending) {
    const email = emailByUser.get(item.userId);
    if (!email) continue;
    await sendCoreLoopEmail({
      supabase,
      userId: item.userId,
      email,
      kind: item.kind,
      subjectId: item.subjectId,
      subject: item.subject,
      html: item.html,
      origin,
    });
    sent++;
  }

  return NextResponse.json({
    candidates: pending.length,
    attempted: sent,
    windowEnd: windowEndIso,
  });
}
