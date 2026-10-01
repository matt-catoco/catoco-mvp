"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { toUserFacingError } from "@/lib/action-errors";
import {
  CONFIRMATION_BUCKET,
  CONFIRMATION_MAX_BYTES,
  CONFIRMATION_MIME_TYPES,
} from "@/lib/booking-confirmation";

export type PrepareConfirmationUploadResult = { error?: string; path?: string; token?: string };

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Issues a one-time signed upload URL for a booking-confirmation
 * attachment. The bucket is private with no storage policies, so this is
 * the only way in: the caller must pass the same authority check
 * report_element_booked() applies (can_report_element_booked), and the
 * object lands under {trip_id}/{element_id}/ — the only prefix
 * report_element_booked() will accept a path from. The bucket itself also
 * enforces the size cap and MIME allowlist server-side.
 */
export async function prepareConfirmationUpload(
  tripId: string,
  elementId: string,
  contentType: string,
  size: number,
): Promise<PrepareConfirmationUploadResult> {
  if (!CONFIRMATION_MIME_TYPES.includes(contentType)) {
    return { error: "Attach a PNG, JPEG, WebP image or a PDF." };
  }
  if (!(size > 0) || size > CONFIRMATION_MAX_BYTES) {
    return { error: "That file is over the 10 MB limit." };
  }

  const supabase = await createClient();
  const { data: allowed, error } = await supabase.rpc("can_report_element_booked", {
    p_element_id: elementId,
  });
  if (error) return { error: toUserFacingError(error) };
  if (!allowed) return { error: "Only the purchaser or an organizer can attach a confirmation." };

  // The element row (read under the caller's own RLS) is the source of the
  // trip id in the path — never the client-supplied tripId.
  const { data: element } = await supabase
    .from("trip_elements")
    .select("trip_id")
    .eq("id", elementId)
    .maybeSingle();
  if (!element || element.trip_id !== tripId) return { error: "Element not found." };

  const path = `${element.trip_id}/${elementId}/${randomUUID()}.${EXT[contentType]}`;
  const { data, error: signError } = await createServiceClient()
    .storage.from(CONFIRMATION_BUCKET)
    .createSignedUploadUrl(path);
  if (signError || !data) {
    return { error: toUserFacingError({ message: signError?.message ?? "signed upload url failed" }) };
  }
  return { path: data.path, token: data.token };
}
