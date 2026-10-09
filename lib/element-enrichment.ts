import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchOptionDetails } from "@/lib/option-details-fetch";
import { readDetails, type ElementImage, type EnrichedDetails } from "@/lib/option-details";
import { PRICE_BEARING_TYPES, type ElementType } from "@/lib/trip-elements";
import { pickUnsplashPhoto, placeQueries } from "@/lib/unsplash";

export type StoredEnrichment = EnrichedDetails & { option_id: string };

/** Element-level photo for a locked option (B3 image rule). */
function imageFor(type: ElementType, value: Record<string, unknown>, vendorImages: string[] | undefined): ElementImage | null {
  if (type === "dates") return null;
  const credit = value.thumbnail_credit as { name?: string; url?: string } | undefined;
  const thumb = typeof value.thumbnail_url === "string" && value.thumbnail_url.trim() ? value.thumbnail_url.trim() : null;
  if (type !== "destination" && vendorImages?.[0]) return { url: vendorImages[0], source: "vendor" };
  if (!thumb) return null;
  return credit?.name
    ? { url: thumb, source: "unsplash", credit_name: credit.name, credit_url: credit.url }
    : { url: thumb, source: "option" };
}

/**
 * The lock-time enrichment pass (staging review B3): once, when an element
 * is first viewed after locking, copy the winning option's details (fetching
 * them now if the option predates submission-time details) and pick the
 * element photo. Re-runs only if the locked option changed (a fallback
 * re-lock). A custom photo the group already chose survives a re-run only
 * for the same option. Best-effort: on any failure the page just renders
 * without the snapshot and tries again next view.
 */
export async function ensureElementEnrichment(opts: {
  elementId: string;
  type: ElementType;
  lockedOptionId: string;
  value: Record<string, unknown>;
  current: StoredEnrichment | null;
}): Promise<StoredEnrichment | null> {
  if (opts.current && opts.current.option_id === opts.lockedOptionId) return opts.current;
  if (opts.type === "dates") return null;
  try {
    let details = readDetails(opts.value);
    if (!details && PRICE_BEARING_TYPES.includes(opts.type)) {
      details = await fetchOptionDetails(opts.type, opts.value);
    }
    let image = imageFor(opts.type, opts.value, details?.images);
    // A Destination submitted before the place-name cascade may have no
    // photo at all (the Bodrum map-only card) — find one now.
    if (!image && opts.type === "destination" && typeof opts.value.name === "string" && opts.value.name.trim()) {
      const photo = await pickUnsplashPhoto(placeQueries(opts.value.name));
      if (photo) {
        image = { url: photo.url, source: "unsplash", credit_name: photo.photographerName, credit_url: photo.photographerProfileUrl };
      }
    }
    const snapshot: StoredEnrichment = {
      option_id: opts.lockedOptionId,
      details,
      image,
      enriched_at: new Date().toISOString(),
    };
    const { error } = await createServiceClient()
      .from("trip_elements")
      .update({ enriched_details: snapshot })
      .eq("id", opts.elementId)
      .eq("locked_option_id", opts.lockedOptionId);
    if (error) {
      console.error(`[enrichment] ${opts.elementId}:`, error.message);
      return snapshot; // still render it this time
    }
    return snapshot;
  } catch (err) {
    console.error(`[enrichment] ${opts.elementId}:`, err);
    return null;
  }
}
