"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeOptionValue,
  validateOptionValue,
  type ElementType,
} from "@/lib/trip-elements";
import { fetchLinkPreview } from "@/lib/link-preview";

/**
 * Marks that the organizer has started inviting people (first "Copy invite
 * link" click). Lives on `trips` now (2026-09-01 redesign) — Participants
 * isn't an element anymore, just a plain trip-level flag. Plain client
 * update, not an RPC — the existing organizer policy on `trips` already
 * grants this.
 */
export async function markInvitesSent(tripId: string) {
  const supabase = await createClient();
  await supabase.from("trips").update({ invites_sent: true }).eq("id", tripId);
}

export type CreateElementResult = { error?: string; elementId?: string };

/**
 * Creates a new element instance — any trip member, not just the organizer,
 * scoped to everyone (scopeUserIds: null) or a hand-picked subset. All the
 * real invariants (who's allowed to lock immediately, that a locked element
 * has exactly one value, that scope members actually belong to the trip)
 * are enforced inside create_element() itself, not here — this just shapes
 * the payload and surfaces whatever the RPC rejects.
 */
export async function createElement(input: {
  tripId: string;
  type: ElementType;
  label: string;
  metadata: Record<string, string>;
  scopeUserIds: string[] | null;
  state: "locked" | "open";
  optionsDeadline?: string | null;
  votingDeadline?: string | null;
  lockedValue?: Record<string, unknown>;
}): Promise<CreateElementResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to add an element." };

  if (!input.label.trim()) return { error: "Give it a label." };

  let options: { value: unknown }[] = [];
  if (input.state === "locked") {
    const err = validateOptionValue(input.type, input.lockedValue);
    if (err) return { error: err };
    options = [{ value: normalizeOptionValue(input.type, input.lockedValue!) }];
  }

  const { data, error } = await supabase.rpc("create_element", {
    p_trip_id: input.tripId,
    p_type: input.type,
    p_label: input.label,
    p_metadata: input.metadata,
    p_scope_user_ids: input.scopeUserIds,
    p_state: input.state,
    p_options_deadline: input.optionsDeadline || null,
    p_voting_deadline: input.votingDeadline || null,
    p_options: options,
  });

  if (error) return { error: error.message };

  revalidatePath(`/trips/${input.tripId}`);
  return { elementId: data as string };
}

export type UpdateElementResult = { error?: string };

/**
 * Fixes a mistake on an already-created element — label, metadata,
 * deadlines, and (if locked) the locked value itself. Authority (creator,
 * organizer, or co-organizer) is enforced inside update_element(), not here.
 */
export async function updateElement(input: {
  tripId: string;
  elementId: string;
  type: ElementType;
  label: string;
  metadata: Record<string, string>;
  state: "locked" | "open";
  optionsDeadline?: string | null;
  votingDeadline?: string | null;
  lockedValue?: Record<string, unknown>;
}): Promise<UpdateElementResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to edit this element." };

  if (!input.label.trim()) return { error: "Give it a label." };

  let lockedValue: unknown = null;
  if (input.state === "locked" && input.lockedValue) {
    const err = validateOptionValue(input.type, input.lockedValue);
    if (err) return { error: err };
    lockedValue = normalizeOptionValue(input.type, input.lockedValue);
  }

  const { error } = await supabase.rpc("update_element", {
    p_element_id: input.elementId,
    p_label: input.label,
    p_metadata: input.metadata,
    p_options_deadline: input.optionsDeadline || null,
    p_voting_deadline: input.votingDeadline || null,
    p_locked_value: lockedValue,
  });

  if (error) return { error: error.message };

  revalidatePath(`/trips/${input.tripId}`);
  revalidatePath(`/trips/${input.tripId}/elements/${input.elementId}`);
  return {};
}

export type SetParticipantRoleResult = { error?: string };

/** Organizer or co-organizer assigns a roster member's role. */
export async function setParticipantRole(
  tripId: string,
  userId: string,
  role: "participant" | "co_organizer",
): Promise<SetParticipantRoleResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_participant_role", {
    p_trip_id: tripId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) return { error: error.message };
  revalidatePath(`/trips/${tripId}/participants`);
  return {};
}

export type SetParticipantCapacityResult = { error?: string };

/** Organizer or co-organizer sets the (informational, non-blocking) min/max. */
export async function setParticipantCapacity(
  tripId: string,
  min: number | null,
  max: number | null,
): Promise<SetParticipantCapacityResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_participant_capacity", {
    p_trip_id: tripId,
    p_min: min,
    p_max: max,
  });
  if (error) return { error: error.message };
  revalidatePath(`/trips/${tripId}/participants`);
  return {};
}

export type SubmitOptionResult = { error: string } | { error?: undefined };

const MICRO_TYPES_WITH_LINK: ElementType[] = [
  "travel",
  "accommodation",
  "experience",
  "dining",
];

/**
 * Lets any trip member (organizer or a joined participant) propose a
 * candidate option on an open element — extends the wizard's creation-time
 * option seeding to post-creation collaboration. RLS (not this function) is
 * the actual authority on who's allowed to insert: membership, `state =
 * 'open'`, and `options_deadline` are all enforced by the "Trip members can
 * propose options on open elements" policy, so a rejected insert surfaces as
 * a plain Postgres error here rather than a bespoke permission check.
 */
export async function submitOption(
  elementId: string,
  rawValue: Record<string, unknown>,
): Promise<SubmitOptionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to propose an option." };

  const { data: element } = await supabase
    .from("trip_elements")
    .select("trip_id, type")
    .eq("id", elementId)
    .maybeSingle();
  if (!element) return { error: "Couldn't find that element." };

  const type = element.type as ElementType;
  const validationError = validateOptionValue(type, rawValue);
  if (validationError) return { error: validationError };

  const value = normalizeOptionValue(type, rawValue) as Record<string, unknown>;

  if (MICRO_TYPES_WITH_LINK.includes(type) && typeof value.booking_link === "string") {
    const preview = await fetchLinkPreview(value.booking_link);
    Object.assign(value, preview);
  }

  const { error } = await supabase.from("element_options").insert({
    element_id: elementId,
    value,
    source: "user_proposed",
    proposed_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/trips/${element.trip_id}`);
  revalidatePath(`/trips/${element.trip_id}/elements/${elementId}`);
  return {};
}

export type CastVotesResult = { error: string } | { error?: undefined };

/**
 * Replaces the caller's top-3 ranking for one element. Full replace, not
 * incremental — cast_votes() deletes their existing votes for this
 * element's options and re-inserts the new order, which is how "edit my
 * ranking" is implemented (per the ticket: editable anytime up to
 * voting_deadline). All the real validation (membership, open, deadline,
 * ≤3, no dupes, options belong to this element) lives in the RPC.
 */
export async function castVotes(
  elementId: string,
  optionIds: string[],
): Promise<CastVotesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to vote." };

  const { error } = await supabase.rpc("cast_votes", {
    p_element_id: elementId,
    p_option_ids: optionIds,
  });
  if (error) return { error: error.message };

  const { data: element } = await supabase
    .from("trip_elements")
    .select("trip_id")
    .eq("id", elementId)
    .maybeSingle();
  if (element) {
    revalidatePath(`/trips/${element.trip_id}`);
    revalidatePath(`/trips/${element.trip_id}/elements/${elementId}`);
  }

  return {};
}
