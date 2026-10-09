"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { safeUrl } from "@/lib/link-preview";
import { searchUnsplashPhotos, trackUnsplashDownload, type UnsplashSearchOutcome } from "@/lib/unsplash";
import type { ElementImage } from "@/lib/option-details";

export async function searchElementPhotos(query: string): Promise<UnsplashSearchOutcome> {
  return searchUnsplashPhotos(query);
}

export type PhotoPick =
  | { kind: "unsplash"; url: string; photographerName: string; photographerProfileUrl: string; downloadLocation: string }
  | { kind: "url"; url: string };

/**
 * "Change photo" on a locked element. Organizer or
 * the element's creator only — the same people who can edit it. Writes
 * only enriched_details.image, via the service client after this check.
 */
export async function setElementImage(tripId: string, elementId: string, pick: PhotoPick): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to change the photo." };

  const [{ data: element }, { data: isOrganizer }] = await Promise.all([
    supabase
      .from("trip_elements")
      .select("id, trip_id, type, state, created_by, locked_option_id, enriched_details")
      .eq("id", elementId)
      .maybeSingle(),
    supabase.rpc("is_trip_organizer", { p_trip_id: tripId }),
  ]);
  if (!element || element.trip_id !== tripId) return { error: "Couldn't find this element." };
  if (!isOrganizer && element.created_by !== user.id) return { error: "Only the organizer or whoever added this can change its photo." };
  if (element.type === "dates") return { error: "Dates don't have a photo." };
  if (element.state !== "locked" || !element.locked_option_id) {
    return { error: "A photo appears once this is locked in." };
  }

  let image: ElementImage;
  if (pick.kind === "unsplash") {
    if (!pick.url.startsWith("https://images.unsplash.com/")) return { error: "That photo isn't from Unsplash." };
    // client-supplied: only ever hit Unsplash's own API with our key
    if (pick.downloadLocation.startsWith("https://api.unsplash.com/")) {
      await trackUnsplashDownload(pick.downloadLocation);
    }
    image = { url: pick.url, source: "unsplash", credit_name: pick.photographerName, credit_url: pick.photographerProfileUrl };
  } else {
    const url = safeUrl(pick.url.trim());
    if (!url || url.protocol !== "https:") return { error: "Use an https:// image link." };
    image = { url: url.toString(), source: "url" };
  }

  const current = (element.enriched_details ?? {}) as Record<string, unknown>;
  const next = {
    details: null,
    enriched_at: new Date().toISOString(),
    ...current,
    // tied to the locked option, so a later fallback re-lock re-enriches
    option_id: element.locked_option_id,
    image,
  };
  const { error } = await createServiceClient().from("trip_elements").update({ enriched_details: next }).eq("id", elementId);
  if (error) return { error: "Couldn't save the photo. Try again." };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}
