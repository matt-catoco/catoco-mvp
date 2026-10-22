import "server-only";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { sendCoreLoopEmail } from "@/lib/notifications";
import { escapeHtml } from "@/lib/html";
import { formatCurrency } from "@/lib/trip-elements";

// Pay-window reminders for pledge-only funding (three-prong Prompt 1 §4):
// once around the middle of the window and once near its end, to people who
// pledged but haven't paid (or said they paid) yet. Uses the existing
// "nudge" kind — no new notification kind (those need the founder's
// approval, Prompt 4). Runs from the hourly job; prepare_notification()
// dedupes each (person, stage) so a reminder goes out once. Emails are off
// on staging (lib/email.ts), and English only for now.

const END_STAGE_HOURS = 6;

function stageSubjectId(fundingRequestId: string, stage: "mid" | "end"): string {
  const h = createHash("md5").update(`pay-window:${fundingRequestId}:${stage}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

type WindowRow = {
  id: string;
  trip_id: string;
  purchaser_id: string | null;
  individual_amount: number;
  currency: string | null;
  pay_window_opened_at: string;
  pay_window_hours: number | null;
  trips: { name: string } | { name: string }[] | null;
  funding_request_elements: { element_id: string }[];
};

export async function sendPayWindowReminders(origin: string): Promise<{ sent: number }> {
  const supabase = createServiceClient();
  const now = Date.now();
  const { data } = await supabase
    .from("funding_requests")
    .select("id, trip_id, purchaser_id, individual_amount, currency, pay_window_opened_at, pay_window_hours, trips(name), funding_request_elements(element_id)")
    .eq("status", "collecting")
    .eq("collection_mode", "peer_pledge")
    .not("pay_window_opened_at", "is", null)
    // No deadline (or pay right away): nothing to count down to.
    .not("pay_window_hours", "is", null)
    .returns<WindowRow[]>();

  let sent = 0;
  for (const fr of data ?? []) {
    const opened = new Date(fr.pay_window_opened_at).getTime();
    if (fr.pay_window_hours == null) continue;
    const closes = opened + fr.pay_window_hours * 3_600_000;
    if (now >= closes) continue;
    const stage: "mid" | "end" | null =
      now >= closes - END_STAGE_HOURS * 3_600_000 ? "end" : now >= opened + (closes - opened) / 2 ? "mid" : null;
    if (!stage) continue;

    const elementId = fr.funding_request_elements[0]?.element_id;
    if (!elementId) continue;
    const [{ data: pledges }, { data: el }, { data: collector }] = await Promise.all([
      supabase.from("funding_pledges").select("participant_id, reference_code").eq("funding_request_id", fr.id).eq("status", "pledged"),
      supabase.from("trip_elements").select("label").eq("id", elementId).maybeSingle(),
      fr.purchaser_id
        ? supabase.from("profiles").select("display_name").eq("id", fr.purchaser_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const trip = Array.isArray(fr.trips) ? fr.trips[0] : fr.trips;
    const label = el?.label ?? "your trip";
    const organizer = (collector as { display_name?: string } | null)?.display_name?.trim() || "the organizer";
    const amount = formatCurrency(Number(fr.individual_amount), fr.currency ?? "EUR");
    const closesText = new Date(closes).toUTCString().replace(/:\d\d GMT$/, " UTC");

    for (const p of (pledges ?? []) as { participant_id: string; reference_code: string }[]) {
      const { data: email } = await supabase.rpc("get_user_email", { p_user_id: p.participant_id });
      if (!email) continue;
      await sendCoreLoopEmail({
        supabase,
        userId: p.participant_id,
        email: email as string,
        kind: "nudge",
        subjectId: stageSubjectId(fr.id, stage),
        subject: `${stage === "end" ? "Last call" : "Reminder"}: pay ${organizer} for ${label}${trip?.name ? ` — ${trip.name}` : ""}`,
        html: `
          <p>Please pay <strong>${escapeHtml(organizer)}</strong> <strong>${escapeHtml(amount)}</strong> for <strong>${escapeHtml(label)}</strong>${
            trip?.name ? ` on <strong>${escapeHtml(trip.name)}</strong>` : ""
          }.</p>
          <p>Use reference <strong>${escapeHtml(p.reference_code)}</strong>. The payment window closes ${escapeHtml(closesText)}.</p>
          <p>You pay ${escapeHtml(organizer)} directly; Catoco never holds your money.</p>
          <p><a href="${origin}/trips/${fr.trip_id}/elements/${elementId}">See how to pay</a></p>
        `,
        origin,
      });
      sent++;
    }
  }
  return { sent };
}
