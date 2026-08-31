"use server";

import { createClient } from "@/lib/supabase/server";

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
