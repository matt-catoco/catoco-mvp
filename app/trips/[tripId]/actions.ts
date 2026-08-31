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
 * link" click). Plain client update, not an RPC — the existing organizer
 * policy on trip_elements already grants this.
 */
export async function markInvitesSent(tripId: string) {
  const supabase = await createClient();
  await supabase
    .from("trip_elements")
    .update({ invites_sent: true })
    .eq("trip_id", tripId)
    .eq("type", "participants");
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
  return {};
}
