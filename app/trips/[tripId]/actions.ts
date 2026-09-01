"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  extractPricing,
  normalizeOptionValue,
  validateOptionValue,
  type ElementType,
} from "@/lib/trip-elements";
import { fetchLinkPreview } from "@/lib/link-preview";

const MICRO_TYPES_WITH_LINK: ElementType[] = [
  "travel",
  "accommodation",
  "experience",
  "dining",
];

/**
 * Scrapes and merges in title/description/thumbnail_url for any value with a
 * booking_link — every write path that can produce one of these types'
 * values goes through this (new submissions, edited submissions, and a
 * locked value set at creation or via edit), so the comparison card on the
 * voting page never depends on which specific path a value came from.
 */
async function applyLinkPreview(
  type: ElementType,
  value: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (MICRO_TYPES_WITH_LINK.includes(type) && typeof value.booking_link === "string") {
    const preview = await fetchLinkPreview(value.booking_link);
    Object.assign(value, preview);
  }
  return value;
}

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

  let options: { value: unknown; unit_price: number | null; pricing_basis: string | null }[] = [];
  if (input.state === "locked") {
    const err = validateOptionValue(input.type, input.lockedValue);
    if (err) return { error: err };
    const value = normalizeOptionValue(input.type, input.lockedValue!) as Record<string, unknown>;
    const withPreview = await applyLinkPreview(input.type, value);
    const { unitPrice, pricingBasis } = extractPricing(withPreview);
    options = [{ value: withPreview, unit_price: unitPrice, pricing_basis: pricingBasis }];
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
    const value = normalizeOptionValue(input.type, input.lockedValue) as Record<string, unknown>;
    lockedValue = await applyLinkPreview(input.type, value);
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

export type DeleteElementResult = { error?: string };

/**
 * Removes an element entirely — not a mistake to fix (that's
 * updateElement), a "this shouldn't exist" (wrong type, duplicate, etc).
 * Same authority as editing (organizer, co-organizer, or the element's own
 * creator), no state restriction. Cascades to its options/votes/scope via
 * existing FKs — nothing extra to clean up here.
 */
export async function deleteElement(
  tripId: string,
  elementId: string,
): Promise<DeleteElementResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_element", { p_element_id: elementId });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
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

  const value = await applyLinkPreview(
    type,
    normalizeOptionValue(type, rawValue) as Record<string, unknown>,
  );
  const { unitPrice, pricingBasis } = extractPricing(value);

  const { error } = await supabase.from("element_options").insert({
    element_id: elementId,
    value,
    source: "user_proposed",
    proposed_by: user.id,
    unit_price: unitPrice,
    pricing_basis: pricingBasis,
  });

  if (error) return { error: error.message };

  revalidatePath(`/trips/${element.trip_id}`);
  revalidatePath(`/trips/${element.trip_id}/elements/${elementId}`);
  return {};
}

export type UpdateOptionResult = { error?: string };

/**
 * Fixes a mistake in an already-submitted candidate (e.g. the wrong price) —
 * the proposer, organizer, or co-organizer, only while the element is still
 * open. Authority + the open-state check are enforced in update_option(),
 * not here.
 */
export async function updateOption(
  optionId: string,
  tripId: string,
  elementId: string,
  type: ElementType,
  rawValue: Record<string, unknown>,
): Promise<UpdateOptionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to edit this." };

  const validationError = validateOptionValue(type, rawValue);
  if (validationError) return { error: validationError };

  const value = await applyLinkPreview(
    type,
    normalizeOptionValue(type, rawValue) as Record<string, unknown>,
  );
  const { unitPrice, pricingBasis } = extractPricing(value);

  const { error } = await supabase.rpc("update_option", {
    p_option_id: optionId,
    p_value: value,
    p_unit_price: unitPrice,
    p_pricing_basis: pricingBasis,
  });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type LockElementResult = { error?: string };

/**
 * Organizer/co-organizer ends voting early and locks one of the current
 * candidates in — the one manual override path, alongside the automatic
 * ones (locking at creation, auto-lock on voting_deadline). Authority + the
 * open-state check are enforced in lock_element(), not here.
 */
export async function lockElement(
  tripId: string,
  elementId: string,
  optionId: string,
): Promise<LockElementResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lock_element", {
    p_element_id: elementId,
    p_option_id: optionId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
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

export type AddFundingContributionResult = { error?: string };

/**
 * The manual contribution ledger stand-in (flow #4) — not a real charge,
 * just bookkeeping (who, how much), so collected-vs-required is actually
 * reachable end to end. Swapped for real Stripe charges in the
 * contribution-charge ticket without touching this schema. Membership +
 * the collecting-only restriction are enforced in add_funding_contribution().
 */
export async function addFundingContribution(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  amount: number,
): Promise<AddFundingContributionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_funding_contribution", {
    p_funding_request_id: fundingRequestId,
    p_amount: amount,
  });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type SetFundingDeadlineResult = { error?: string };

/**
 * Organizer/co-organizer only. A funding_request's deadline starts null
 * (same lazy-resolution pattern as voting_deadline) and is cleared back to
 * null on an unfunded-but-still-viable retry — nothing resolves until this
 * is explicitly set, never silently open-ended.
 */
export async function setFundingDeadline(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  deadline: string,
): Promise<SetFundingDeadlineResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_funding_deadline", {
    p_funding_request_id: fundingRequestId,
    p_deadline: deadline,
  });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type ResolveFundingOutcomeResult = { error?: string };

/**
 * Organizer/co-organizer, once a funding_deadline has passed. Funded ->
 * ready_to_purchase. Unfunded: `stillViable` is the manual viability
 * answer (no Travelpayouts/Viator integration exists yet, so every type
 * gets the same self-report check Dining always had) — true reopens
 * collecting with a cleared deadline, false runs the runner-up/reopen
 * fallback.
 */
export async function resolveFundingOutcome(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  stillViable: boolean,
): Promise<ResolveFundingOutcomeResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_funding_outcome", {
    p_funding_request_id: fundingRequestId,
    p_still_viable: stillViable,
  });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type ReportElementBookedResult = { error?: string };

/**
 * The purchaser (or organizer/co-organizer) self-reports the outcome once
 * ready_to_purchase — Booked (with an optional actual amount, defaulting
 * to required_amount) or Unavailable, which runs the exact same fallback
 * cascade as an unfunded-and-no-longer-viable funding_request. Works the
 * same for payment_type=none elements too (no funding_request at all) —
 * they still get a booking-confirmation step per the ticket.
 */
export async function reportElementBooked(
  tripId: string,
  elementId: string,
  outcome: "booked" | "unavailable",
  actualAmountPaid?: number,
): Promise<ReportElementBookedResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_element_booked", {
    p_element_id: elementId,
    p_outcome: outcome,
    p_actual_amount_paid: actualAmountPaid ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type BundleFundingRequestsResult = { error?: string; fundingRequestId?: string };

/**
 * Organizer/co-organizer merges several single-element, still-collecting
 * funding_requests into one — a separate manual action, never automatic.
 * No dedicated picker UI yet (flagged as thin in the plan); this wraps the
 * RPC for whenever that lands.
 */
export async function bundleFundingRequests(
  tripId: string,
  elementIds: string[],
): Promise<BundleFundingRequestsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bundle_funding_requests", {
    p_element_ids: elementIds,
  });
  if (error) return { error: error.message };

  revalidatePath(`/trips/${tripId}`);
  return { fundingRequestId: data as string };
}
