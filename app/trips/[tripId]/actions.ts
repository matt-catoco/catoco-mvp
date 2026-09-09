"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  extractPricing,
  normalizeOptionValue,
  validateOptionValue,
  type ElementType,
} from "@/lib/trip-elements";
import { fetchLinkPreview } from "@/lib/link-preview";
import { fetchUnsplashPhoto } from "@/lib/unsplash";
import { sendCoreLoopEmail } from "@/lib/notifications";
import { toUserFacingError } from "@/lib/action-errors";

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
  // §10 auto-photo: Destination has no booking_link to scrape an OG image
  // from at all, so Unsplash is its only photo source. Experience/Dining
  // fall back to Unsplash only when the OG scrape above didn't turn up an
  // image — a real listing's own photo still wins when there is one.
  if (type === "destination" && typeof value.name === "string" && !value.thumbnail_url) {
    const photo = await fetchUnsplashPhoto(value.name);
    if (photo) value.thumbnail_url = photo;
  } else if ((type === "experience" || type === "dining") && !value.thumbnail_url) {
    const query = [value.name, value.location_name]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(" ");
    if (query) {
      const photo = await fetchUnsplashPhoto(query);
      if (photo) value.thumbnail_url = photo;
    }
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
  // Funding bundling (chain-at-creation): bundleGroupId joins an existing
  // bundle (the anchor element's id); startBundle tags THIS element as a
  // new bundle's anchor (mutually exclusive with bundleGroupId); bundleContinues
  // says more elements are still coming in the same chaining session, so
  // create_element() must not check the bundle's funding readiness yet even
  // if this element locks immediately — see that RPC's own comment for why.
  bundleGroupId?: string | null;
  startBundle?: boolean;
  bundleContinues?: boolean;
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
    p_bundle_group_id: input.bundleGroupId || null,
    p_start_bundle: input.startBundle ?? false,
    p_bundle_continues: input.bundleContinues ?? false,
  });

  if (error) return { error: toUserFacingError(error) };

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

  if (error) return { error: toUserFacingError(error) };

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
  if (error) return { error: toUserFacingError(error) };

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
  if (error) return { error: toUserFacingError(error) };
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
  if (error) return { error: toUserFacingError(error) };
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
    .select("trip_id, type, voting_deadline")
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

  if (error) return { error: toUserFacingError(error) };

  // §2: a Nights-mode Dates option auto-creates a second Dates element
  // (exact-dates mode) for the group to pin down real calendar dates, once
  // this one locks in. Only once per original element, even if several
  // different Nights options get proposed for it -- guarded by
  // derived_from_element_id, not just "did this call submit a nights value."
  if (type === "dates" && "nights" in value && element.voting_deadline) {
    const { data: existingDerived } = await supabase
      .from("trip_elements")
      .select("id")
      .eq("derived_from_element_id", elementId)
      .maybeSingle();

    if (!existingDerived) {
      const votingDeadline = new Date(element.voting_deadline);
      const newOptionsDeadline = new Date(votingDeadline.getTime() + 7 * 24 * 60 * 60 * 1000);
      const newVotingDeadline = new Date(votingDeadline.getTime() + 14 * 24 * 60 * 60 * 1000);
      await supabase.rpc("create_element", {
        p_trip_id: element.trip_id,
        p_type: "dates",
        p_label: "Dates",
        p_metadata: {},
        p_scope_user_ids: null,
        p_state: "open",
        p_options_deadline: newOptionsDeadline.toISOString(),
        p_voting_deadline: newVotingDeadline.toISOString(),
        p_options: [],
        p_derived_from_element_id: elementId,
      });
      // Best-effort: a failure here shouldn't undo the option that already
      // saved successfully above -- no error surfaced to the proposer for
      // this secondary step.
    }
  }

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
  if (error) return { error: toUserFacingError(error) };

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
  if (error) return { error: toUserFacingError(error) };

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
  if (error) return { error: toUserFacingError(error) };

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
  if (error) return { error: toUserFacingError(error) };

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
  if (error) return { error: toUserFacingError(error) };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type ReassignPurchaserResult = { error?: string };

/**
 * Organizer/co-organizer only. Purchaser defaults to the trip organizer at
 * lock-in (create_funding_request_for_element) -- this lets them hand it off
 * to any other participant instead. isPurchaser-gated functional access
 * (contribute, Mark booked, Report unavailable) is a separate, still
 * user-ID-based check that isn't affected by who can see this control.
 */
export async function reassignPurchaser(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  purchaserId: string,
): Promise<ReassignPurchaserResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reassign_purchaser", {
    p_funding_request_id: fundingRequestId,
    p_purchaser_id: purchaserId,
  });
  if (error) return { error: toUserFacingError(error) };

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
  if (error) return { error: toUserFacingError(error) };

  // Trigger #2 (funding ready to purchase): re-select rather than trusting
  // stillViable alone — resolve_funding_outcome() also independently checks
  // collected >= required first, regardless of which button was clicked, so
  // the actual resulting status is the only reliable signal.
  const { data: fr } = await supabase
    .from("funding_requests")
    .select("status, purchaser_id, required_amount")
    .eq("id", fundingRequestId)
    .maybeSingle();

  if (fr?.status === "ready_to_purchase" && fr.purchaser_id) {
    const [{ data: purchaserEmail }, { data: trip }, { data: element }] = await Promise.all([
      supabase.rpc("get_user_email", { p_user_id: fr.purchaser_id }),
      supabase.from("trips").select("name").eq("id", tripId).maybeSingle(),
      supabase.from("trip_elements").select("label").eq("id", elementId).maybeSingle(),
    ]);

    if (purchaserEmail && trip && element) {
      const h = await headers();
      const host = h.get("host");
      const proto = process.env.NODE_ENV === "development" ? "http" : "https";
      const origin = host ? `${proto}://${host}` : "https://catoco.co";
      const url = `${origin}/trips/${tripId}/elements/${elementId}`;

      await sendCoreLoopEmail({
        supabase,
        userId: fr.purchaser_id,
        email: purchaserEmail as string,
        kind: "funding_ready",
        subjectId: fundingRequestId,
        subject: `Funding hit the goal for ${element.label} — ${trip.name}`,
        html: `
          <p>Funding hit the goal for <strong>${element.label}</strong> on <strong>${trip.name}</strong> — ${fr.required_amount.toFixed(2)} collected. Go ahead and complete the purchase.</p>
          <p><a href="${url}">Take a look</a></p>
        `,
        origin,
      });
    }
  }
  // purchaser_id null shouldn't happen per the current purchaser-assignment
  // logic, but don't let a missing purchaser or a failed email block the
  // resolve action that already succeeded above.

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
  if (error) return { error: toUserFacingError(error) };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type UpdateTripResult = { error?: string };

/**
 * Rename and/or icon change — organizer or co-organizer (update_trip()'s
 * own authority check), matching the existing edit/delete-element
 * precedent. setIcon distinguishes "leave the icon alone" (icon omitted)
 * from "clear it" (icon explicitly null, IconPicker's Remove) — both would
 * otherwise arrive at the RPC as the same SQL NULL.
 */
export async function updateTrip(
  tripId: string,
  input: { name?: string; icon?: string | null; setIcon?: boolean },
): Promise<UpdateTripResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_trip", {
    p_trip_id: tripId,
    p_name: input.name?.trim() || null,
    p_icon: input.setIcon ? input.icon ?? null : null,
    p_set_icon: input.setIcon ?? false,
  });
  if (error) return { error: toUserFacingError(error) };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/settings`);
  revalidatePath("/trips");
  return {};
}

export type DeleteTripResult = { error?: string };

/**
 * Organizer-only (delete_trip()'s own strict auth.uid() = organizer_id
 * check, not the broader organizer/co-organizer parity everything else on
 * this page uses) — deletion is uniquely irreversible and wipes every
 * participant's contribution history, not just the organizer's own data.
 * Blocked server-side while any unrefunded, contributed-to (or ready/
 * booked) funding_request exists; the caller (the settings page) surfaces
 * that exception message plainly rather than retrying or reinterpreting it.
 */
export async function deleteTrip(tripId: string): Promise<DeleteTripResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_trip", { p_trip_id: tripId });
  if (error) return { error: toUserFacingError(error) };
  return {};
}

export type MarkFundingRequestRefundedResult = { error?: string };

/**
 * The manual overlay flag standing in for real refund processing (§3 of
 * the trip-settings prompt) — organizer/co-organizer, matching every other
 * funding RPC's authority level (resolve_funding_outcome,
 * report_element_booked, ...). Clears delete_trip()'s block for whichever
 * funding_request this was called on.
 */
export async function markFundingRequestRefunded(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
): Promise<MarkFundingRequestRefundedResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_funding_request_refunded", {
    p_funding_request_id: fundingRequestId,
  });
  if (error) return { error: toUserFacingError(error) };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  revalidatePath(`/trips/${tripId}/settings`);
  return {};
}

