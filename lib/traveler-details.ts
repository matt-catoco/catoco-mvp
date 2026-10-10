import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirementFor, type TravelerRequirement } from "@/lib/traveler-fields";
import { travelerCryptoConfigured } from "@/lib/traveler-crypto";
import type { ElementType } from "@/lib/trip-elements";

/**
 * Server-side traveler-detail rules (service client only — the table has no
 * RLS policies). Who has to provide details:
 *  - scope "each": every participant opted into the element;
 *  - scope "lead": the lead guest = the purchaser of the element's live
 *    funding request (organizer when there is none).
 * Only the purchaser can read them, and only once funding is confirmed.
 */

export async function elementRequirement(service: SupabaseClient, elementId: string): Promise<{
  req: TravelerRequirement | null;
  tripId: string;
  label: string;
} | null> {
  const { data: el } = await service
    .from("trip_elements")
    .select("id, trip_id, type, label, locked_option_id, required_traveler_fields")
    .eq("id", elementId)
    .maybeSingle();
  if (!el) return null;
  let value: Record<string, unknown> | undefined;
  if (el.locked_option_id) {
    const { data: opt } = await service.from("element_options").select("value").eq("id", el.locked_option_id).maybeSingle();
    value = (opt?.value ?? undefined) as Record<string, unknown> | undefined;
  }
  return { req: requirementFor(el.type as ElementType, value, el.required_traveler_fields), tripId: el.trip_id, label: el.label };
}

export async function liveFundingRequest(service: SupabaseClient, elementId: string) {
  const { data } = await service
    .from("funding_request_elements")
    .select("funding_requests!inner(id, purchaser_id, status, created_at)")
    .eq("element_id", elementId);
  return ((data ?? []) as unknown as { funding_requests: { id: string; purchaser_id: string | null; status: string; created_at: string } }[])
    .map((r) => r.funding_requests)
    .filter((f) => f.status !== "superseded")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export async function leadGuestId(service: SupabaseClient, elementId: string, tripId: string): Promise<string | null> {
  const fr = await liveFundingRequest(service, elementId);
  if (fr?.purchaser_id) return fr.purchaser_id;
  const { data: trip } = await service.from("trips").select("organizer_id").eq("id", tripId).maybeSingle();
  return trip?.organizer_id ?? null;
}

/** Does this user have to provide details for this element? */
export async function requirementAppliesTo(
  service: SupabaseClient,
  elementId: string,
  tripId: string,
  req: TravelerRequirement,
  userId: string,
): Promise<boolean> {
  if (req.scope === "lead") return (await leadGuestId(service, elementId, tripId)) === userId;
  const { data } = await service
    .from("element_participants")
    .select("opted_in")
    .eq("element_id", elementId)
    .eq("participant_id", userId)
    .maybeSingle();
  return Boolean(data?.opted_in);
}

export async function hasCompleteDetails(service: SupabaseClient, elementId: string, userId: string, req: TravelerRequirement) {
  const { data } = await service
    .from("element_traveler_details")
    .select("fields, confirmed_match")
    .eq("element_id", elementId)
    .eq("participant_id", userId)
    .maybeSingle();
  return Boolean(data?.confirmed_match) && req.fields.every((f) => (data?.fields ?? []).includes(f));
}

/**
 * The commit gate: element labels in this funding request the user still
 * owes traveler details for. Empty when nothing's owed — or when encryption
 * isn't configured in this environment (then details can't be stored, so
 * they can't be required).
 */
export async function travelerDetailsOwed(service: SupabaseClient, fundingRequestId: string, userId: string): Promise<string[]> {
  if (!travelerCryptoConfigured()) return [];
  const { data: rows } = await service.from("funding_request_elements").select("element_id").eq("funding_request_id", fundingRequestId);
  const owed: string[] = [];
  for (const { element_id } of rows ?? []) {
    const info = await elementRequirement(service, element_id);
    if (!info?.req) continue;
    if (!(await requirementAppliesTo(service, element_id, info.tripId, info.req, userId))) continue;
    if (!(await hasCompleteDetails(service, element_id, userId, info.req))) owed.push(info.label);
  }
  return owed;
}
