"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyRefundRequested } from "@/lib/notifications";
import { toUserFacingError } from "@/lib/action-errors";
import { isValidIban, normalizeIban, PLEDGE_TERMS_VERSION } from "@/lib/pledge";
import { getLocale } from "@/lib/i18n/server";
import { cushionArgs, type CushionChoice } from "@/lib/cushion";

// Pledge-only collection (three-prong Prompt 1). Every action is a thin
// wrapper around an RPC that re-checks who may do what; nothing here moves
// money — the organizer collects outside Catoco and confirms here.

type Result = { error?: string };

function revalidate(tripId: string, elementId: string) {
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
}

async function rpc(name: string, args: Record<string, unknown>, tripId: string, elementId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return { error: toUserFacingError(error) };
  revalidate(tripId, elementId);
  return {};
}

/** Member: accept the terms and pledge their share. Records the terms version and language shown. */
export async function acceptPledge(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  cushion: CushionChoice = { kind: "none" },
): Promise<Result> {
  const { p_cushion_kind, p_cushion_value } = cushionArgs(cushion);
  return rpc(
    "accept_pledge",
    {
      p_funding_request_id: fundingRequestId,
      p_terms_version: PLEDGE_TERMS_VERSION,
      p_locale: await getLocale(),
      p_cushion_kind,
      p_cushion_value,
    },
    tripId,
    elementId,
  );
}

export async function setPledgeStatusVisibility(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  show: boolean,
): Promise<Result> {
  return rpc("set_pledge_status_visibility", { p_funding_request_id: fundingRequestId, p_show: show }, tripId, elementId);
}

export async function withdrawPledge(tripId: string, elementId: string, fundingRequestId: string): Promise<Result> {
  return rpc("withdraw_pledge", { p_funding_request_id: fundingRequestId }, tripId, elementId);
}

/** Member: "I've paid" — shows as pending until the organizer confirms. */
export async function reportPledgePaid(tripId: string, elementId: string, fundingRequestId: string): Promise<Result> {
  return rpc("report_pledge_paid", { p_funding_request_id: fundingRequestId }, tripId, elementId);
}

/**
 * Organizer: mark payments as received. The `source` seam is for later open
 * banking auto-confirmation (future work); today it's always the organizer.
 */
export async function confirmPledgePayments(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  participantIds: string[],
  source: "organizer" = "organizer",
): Promise<Result> {
  void source;
  if (participantIds.length === 0) return {};
  return rpc("confirm_pledge_payments", { p_funding_request_id: fundingRequestId, p_participant_ids: participantIds }, tripId, elementId);
}

export async function undoPledgePayment(tripId: string, elementId: string, fundingRequestId: string, participantId: string): Promise<Result> {
  return rpc("undo_pledge_payment", { p_funding_request_id: fundingRequestId, p_participant_id: participantId }, tripId, elementId);
}

export async function openPayWindow(tripId: string, elementId: string, fundingRequestId: string): Promise<Result> {
  return rpc("open_pay_window", { p_funding_request_id: fundingRequestId }, tripId, elementId);
}

export async function setPledgeSettings(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  payTiming: "immediate" | "after_all",
  windowHours: number | null,
): Promise<Result> {
  return rpc(
    "set_pledge_settings",
    {
      p_funding_request_id: fundingRequestId,
      p_pay_timing: payTiming,
      p_window_hours: payTiming === "immediate" || windowHours == null ? null : Math.round(windowHours),
    },
    tripId,
    elementId,
  );
}

/** Member: paid, then pushed above their cushion — leave and ask the organizer for the money back. */
export async function requestPledgeRefund(tripId: string, elementId: string, fundingRequestId: string): Promise<Result> {
  const supabase = await createClient();
  const { data: amount, error } = await supabase.rpc("request_pledge_refund", { p_funding_request_id: fundingRequestId });
  if (error) return { error: toUserFacingError(error) };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const h = await headers();
  const host = h.get("host");
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  await notifyRefundRequested({
    supabase: createServiceClient(),
    fundingRequestId,
    requesterId: user?.id ?? "",
    amount: Number(amount ?? 0),
    origin: host ? `${proto}://${host}` : "https://catoco.co",
  });
  revalidate(tripId, elementId);
  return {};
}

/** Organizer: they've refunded this person outside Catoco. */
export async function markPledgeRefunded(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  participantId: string,
): Promise<Result> {
  return rpc("mark_pledge_refunded", { p_funding_request_id: fundingRequestId, p_participant_id: participantId }, tripId, elementId);
}

export async function removeUnpaidAndRecalculate(tripId: string, elementId: string, fundingRequestId: string): Promise<Result> {
  return rpc("remove_unpaid_and_recalculate", { p_funding_request_id: fundingRequestId }, tripId, elementId);
}

// ---- payout methods (the organizer's own; RLS limits rows to the owner) -------

export async function addPayoutMethod(
  tripId: string,
  elementId: string,
  input: { kind: "iban"; accountName: string; iban: string } | { kind: "link"; url: string } | { kind: "qr"; qrPath: string },
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to continue." };

  let row: Record<string, unknown>;
  if (input.kind === "iban") {
    if (!input.accountName.trim()) return { error: "Add the account holder's name." };
    if (!isValidIban(input.iban)) return { error: "That IBAN doesn't look right. Check the letters and numbers." };
    row = { kind: "iban", account_name: input.accountName.trim().slice(0, 70), iban: normalizeIban(input.iban) };
  } else if (input.kind === "link") {
    let url: URL;
    try {
      url = new URL(input.url.trim());
    } catch {
      return { error: "Enter a link that starts with https://" };
    }
    if (url.protocol !== "https:") return { error: "Enter a link that starts with https://" };
    row = { kind: "link", url: url.toString(), label: url.hostname.replace(/^www\./, "") };
  } else {
    // Must be in the caller's own folder of the private bucket (RLS enforced the upload too).
    if (!input.qrPath.startsWith(`${user.id}/`)) return { error: "Upload the QR image again." };
    row = { kind: "qr", qr_path: input.qrPath };
  }
  const { error } = await supabase.from("payout_methods").insert({ ...row, user_id: user.id });
  if (error) return { error: toUserFacingError(error) };
  revalidate(tripId, elementId);
  return {};
}

export async function removePayoutMethod(tripId: string, elementId: string, id: string): Promise<Result> {
  const supabase = await createClient();
  const { data: removed, error } = await supabase.from("payout_methods").delete().eq("id", id).select("qr_path").maybeSingle();
  if (error) return { error: toUserFacingError(error) };
  if (removed?.qr_path) await supabase.storage.from("payout-qr").remove([removed.qr_path as string]);
  revalidate(tripId, elementId);
  return {};
}
