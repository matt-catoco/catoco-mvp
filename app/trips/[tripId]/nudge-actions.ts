"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { sendCoreLoopEmail } from "@/lib/notifications";
import { toUserFacingError } from "@/lib/action-errors";

export type NudgeResult = { error?: string; sent?: number };

type NudgeTarget = { participant_id: string; display_name: string | null; phase: string; deadline: string | null };

const PHASE_ASK = {
  submission: "add an option",
  voting: "vote",
  funding: "commit your share",
} as Record<string, string>;

/**
 * Organizer-only "Nudge": emails everyone in scope who hasn't acted in the
 * element's current phase (get_element_nudge_targets() decides who — the
 * same status layer as the card alerts). No cooldown by design: each send
 * gets a fresh subjectId so prepare_notification() never dedupes it, but
 * the per-user email opt-out is still honoured.
 */
export async function nudgeElement(tripId: string, elementId: string): Promise<NudgeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_element_nudge_targets", { p_element_id: elementId });
  if (error) return { error: toUserFacingError(error) };
  const targets = (data ?? []) as NudgeTarget[];
  if (targets.length === 0) return { sent: 0 };

  const [{ data: emails }, { data: trip }, { data: element }] = await Promise.all([
    supabase.rpc("get_user_emails", { p_user_ids: targets.map((t) => t.participant_id) }),
    supabase.from("trips").select("name").eq("id", tripId).maybeSingle(),
    supabase.from("trip_elements").select("label").eq("id", elementId).maybeSingle(),
  ]);
  if (!trip || !element) return { error: "Couldn't find this element." };
  const emailById = new Map(((emails ?? []) as { user_id: string; email: string }[]).map((r) => [r.user_id, r.email]));

  const h = await headers();
  const host = h.get("host");
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  const origin = host ? `${proto}://${host}` : "https://www.catoco.co";
  const url = `${origin}/trips/${tripId}/elements/${elementId}`;
  const sendId = randomUUID();

  let sent = 0;
  for (const t of targets) {
    const email = emailById.get(t.participant_id);
    if (!email) continue;
    const ask = PHASE_ASK[t.phase] ?? "take a look";
    const by = t.deadline
      ? ` by <strong>${new Date(t.deadline).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</strong>`
      : "";
    await sendCoreLoopEmail({
      supabase,
      userId: t.participant_id,
      email,
      kind: "nudge",
      subjectId: sendId,
      subject: `Reminder: ${element.label} — ${trip.name}`,
      html: `
        <p>A friendly nudge from your organizer: the group is waiting on you to ${ask} for <strong>${element.label}</strong> on <strong>${trip.name}</strong>${by}.</p>
        <p><a href="${url}">Take a look</a></p>
      `,
      origin,
    });
    sent++;
  }
  return { sent };
}
