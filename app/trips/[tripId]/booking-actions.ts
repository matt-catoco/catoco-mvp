"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toUserFacingError } from "@/lib/action-errors";

/** Fields the organizer/purchaser can set on a booking record (all optional). */
export type BookingRecordInput = {
  vendor?: string;
  confirmation_ref?: string;
  starts_at?: string;
  ends_at?: string;
  address?: string;
  checkin_instructions?: string;
  cancellation_deadline?: string;
  cancellation_policy?: string;
  notes?: string;
  document_path?: string;
  lead_booker_id?: string;
  amount_charged?: string;
  currency?: string;
  source?: "email" | "upload" | "manual";
  field_provenance?: Record<string, "extracted" | "entered">;
  paid_at_property_note?: string;
  fulfillment_mode?: "affiliate_redirect" | "issuing_manual";
  seller_of_record?: "supplier";
};

function revalidate(tripId: string, elementId: string) {
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
}

/** datetime-local ("2026-11-13T15:00") → ISO; "" stays "" (clears). */
function toIso(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (!v.trim()) return "";
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * Save the record; with `confirm`, also lock in that the organizer checked
 * the fields (required before Booked) and, unless it's a pay-later booking,
 * mark the element Booked in the same step.
 */
export async function saveBookingRecord(
  tripId: string,
  elementId: string,
  input: BookingRecordInput,
  opts: { confirm: boolean; markBooked: boolean },
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const record: Record<string, unknown> = { ...input };
  for (const k of ["starts_at", "ends_at", "cancellation_deadline"] as const) {
    if (k in input) record[k] = toIso(input[k]);
  }
  const { error } = await supabase.rpc("save_element_booking", {
    p_element_id: elementId,
    p_record: record,
    p_confirm: opts.confirm,
  });
  if (error) return { error: toUserFacingError(error) };

  if (opts.markBooked) {
    const amount = input.amount_charged ? Number(input.amount_charged) : null;
    const { error: bookErr } = await supabase.rpc("report_element_booked", {
      p_element_id: elementId,
      p_outcome: "booked",
      p_actual_amount_paid: Number.isFinite(amount) ? amount : null,
    });
    if (bookErr) {
      revalidate(tripId, elementId);
      return { error: toUserFacingError(bookErr) };
    }
  }
  revalidate(tripId, elementId);
  return {};
}

export async function reportElementUnavailable(tripId: string, elementId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_element_booked", { p_element_id: elementId, p_outcome: "unavailable" });
  if (error) return { error: toUserFacingError(error) };
  revalidate(tripId, elementId);
  return {};
}

/**
 * Pay-later / pay-at-property: the booking is made first; funding moves to
 * 7 days before the earlier of the supplier's first charge date and the
 * free-cancellation deadline. Returns that funding date.
 */
export async function recordDeferredBooking(
  tripId: string,
  elementId: string,
  input: { paymentTiming: "pay_later" | "pay_at_property"; freeCancelUntil: string; chargeWindowStart: string; chargeWindowEnd?: string },
): Promise<{ error?: string; fundingDueAt?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_deferred_booking", {
    p_element_id: elementId,
    p_payment_timing: input.paymentTiming,
    p_free_cancel_until: toIso(input.freeCancelUntil) || null,
    p_charge_window_start: toIso(input.chargeWindowStart) || null,
    p_charge_window_end: toIso(input.chargeWindowEnd) || null,
  });
  if (error) return { error: toUserFacingError(error) };
  revalidate(tripId, elementId);
  return { fundingDueAt: data as string };
}

/** The element's forward-to address, or null when inbound email isn't set up here. */
export async function getForwardingAddress(elementId: string): Promise<{ error?: string; address?: string | null }> {
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  if (!domain) return { address: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_element_inbound_token", { p_element_id: elementId });
  if (error) return { error: toUserFacingError(error) };
  return { address: `booking-${data as string}@${domain}` };
}
