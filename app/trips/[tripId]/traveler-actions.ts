"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptJson, encryptJson, travelerCryptoConfigured } from "@/lib/traveler-crypto";
import {
  TRAVELER_FIELD_LABEL,
  travelerDetailsError,
  type TravelerDetails,
  type TravelerField,
  type TravelerRequirement,
} from "@/lib/traveler-fields";
import { elementRequirement, liveFundingRequest, requirementAppliesTo } from "@/lib/traveler-details";

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Save the caller's own details for one element (commit step). Only the
 * fields the element requires are kept; values are encrypted before they
 * leave this function.
 */
export async function saveMyTravelerDetails(
  tripId: string,
  elementId: string,
  details: TravelerDetails,
  confirmedMatch: boolean,
): Promise<{ error?: string }> {
  if (!travelerCryptoConfigured()) return { error: "Traveler details can't be stored in this environment yet." };
  const uid = await currentUserId();
  if (!uid) return { error: "Please sign in again." };
  if (!confirmedMatch) return { error: "Confirm the details match your ID." };

  const service = createServiceClient();
  const info = await elementRequirement(service, elementId);
  if (!info?.req || info.tripId !== tripId) return { error: "This element doesn't need traveler details." };
  if (!(await requirementAppliesTo(service, elementId, info.tripId, info.req, uid))) {
    return { error: "Only travelers on this element can add details here." };
  }
  const clean: TravelerDetails = {};
  for (const f of info.req.fields) clean[f] = (details[f] ?? "").trim();
  const err = travelerDetailsError(info.req, clean);
  if (err) return { error: err };

  const { error } = await service.from("element_traveler_details").upsert({
    element_id: elementId,
    participant_id: uid,
    data_enc: encryptJson(clean),
    fields: info.req.fields,
    confirmed_match: true,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: "Couldn't save your details. Try again." };
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}

export type TravelerBlock = { participantId: string; name: string; lines: { label: string; value: string }[] };

/**
 * For the purchaser on Ready to Book: everyone's details as copy-ready
 * blocks. Only the purchaser, only once funding is confirmed (ready to
 * purchase or booked). Every row decrypted here is logged as a view.
 */
export async function loadTravelerDetailsForBooking(elementId: string): Promise<{ error?: string; travelers?: TravelerBlock[] }> {
  if (!travelerCryptoConfigured()) return { error: "Traveler details aren't available in this environment yet." };
  const uid = await currentUserId();
  if (!uid) return { error: "Please sign in again." };
  const service = createServiceClient();
  const fr = await liveFundingRequest(service, elementId);
  if (!fr || fr.purchaser_id !== uid) return { error: "Only the person booking can see traveler details." };
  if (fr.status !== "ready_to_purchase" && fr.status !== "booked") {
    return { error: "Traveler details unlock once funding is complete." };
  }

  const { data: rows } = await service
    .from("element_traveler_details")
    .select("participant_id, data_enc")
    .eq("element_id", elementId);
  const { data: profiles } = await service
    .from("profiles")
    .select("id, display_name")
    .in("id", (rows ?? []).map((r) => r.participant_id));
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null)?.trim() || "Traveler"]));

  const travelers: TravelerBlock[] = [];
  for (const r of rows ?? []) {
    const d = decryptJson<TravelerDetails>(r.data_enc);
    travelers.push({
      participantId: r.participant_id,
      name: nameById.get(r.participant_id) ?? "Traveler",
      lines: (Object.keys(d) as TravelerField[]).filter((f) => d[f]).map((f) => ({ label: TRAVELER_FIELD_LABEL[f].replace(/ \(.*\)$/, ""), value: d[f]! })),
    });
  }
  if (rows?.length) {
    await service.from("traveler_detail_access_log").insert(
      rows.map((r) => ({ element_id: elementId, participant_id: r.participant_id, viewed_by: uid })),
    );
  }
  return { travelers };
}

/** Organizer/purchaser: what this element's vendor needs (name/DOB/email only). */
export async function setTravelerRequirement(
  tripId: string,
  elementId: string,
  req: TravelerRequirement | null,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_required_traveler_fields", {
    p_element_id: elementId,
    p_fields: req, // null = back to the type default
  });
  if (error) return { error: "Couldn't save that." };
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}
