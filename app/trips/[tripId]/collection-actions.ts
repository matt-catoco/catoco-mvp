"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { toUserFacingError } from "@/lib/action-errors";
import { isCollectionMode } from "@/lib/collection-modes";
import { collectionModeEnabled } from "@/lib/collection-mode-flags";

/**
 * The organizer picks how the group pays (Prompt 0). The feature flag is
 * checked HERE, server-side, and set_collection_mode() is callable by the
 * service role only — so a disabled mode can't be selected through the UI or
 * by calling the database directly. The RPC re-checks the organizer and that
 * nobody has committed yet.
 */
export async function selectCollectionMode(
  tripId: string,
  elementId: string,
  fundingRequestId: string,
  mode: string,
): Promise<{ error?: string }> {
  if (!isCollectionMode(mode)) return { error: "That isn't a way to collect." };
  if (!collectionModeEnabled(mode)) return { error: "That way to collect isn't available yet." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to continue." };
  const { error } = await createServiceClient().rpc("set_collection_mode", {
    p_funding_request_id: fundingRequestId,
    p_mode: mode,
    p_actor: user.id,
  });
  if (error) return { error: toUserFacingError(error) };
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
  return {};
}
