"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toUserFacingError } from "@/lib/action-errors";

/**
 * Leaving / removal / element opt-in-out. Every rule (who may, pre-lock
 * only, whole-bundle, the money guard) lives in the security-definer RPCs —
 * direct table writes are revoked (20261001000000_opt_out.sql), so these
 * are thin wrappers that surface the RPC's own plain-language message.
 */

export type ParticipationResult = { error?: string };

function revalidateTrip(tripId: string, elementId?: string) {
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/participants`);
  if (elementId) revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  revalidatePath("/trips");
}

export async function leaveTrip(tripId: string): Promise<ParticipationResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_trip", { p_trip_id: tripId });
  if (error) return { error: toUserFacingError(error) };
  revalidateTrip(tripId);
  return {};
}

export async function removeParticipant(tripId: string, userId: string): Promise<ParticipationResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_participant", { p_trip_id: tripId, p_user_id: userId });
  if (error) return { error: toUserFacingError(error) };
  revalidateTrip(tripId);
  return {};
}

/** Yourself, for an element you're in scope for (whole bundle if bundled). */
export async function setElementOptIn(
  tripId: string,
  elementId: string,
  optedIn: boolean,
): Promise<ParticipationResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_element_opt_in", {
    p_element_id: elementId,
    p_opted_in: optedIn,
  });
  if (error) return { error: toUserFacingError(error) };
  revalidateTrip(tripId, elementId);
  return {};
}

/** Organizer/co-organizer, for anyone on the trip. */
export async function setElementParticipant(
  tripId: string,
  elementId: string,
  userId: string,
  optedIn: boolean,
): Promise<ParticipationResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_element_participant", {
    p_element_id: elementId,
    p_user_id: userId,
    p_opted_in: optedIn,
  });
  if (error) return { error: toUserFacingError(error) };
  revalidateTrip(tripId, elementId);
  return {};
}
