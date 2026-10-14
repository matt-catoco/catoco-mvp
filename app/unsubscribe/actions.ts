"use server";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Undo on the unsubscribe page: turns the same flag back on
 * (profiles.email_notifications_enabled), authorized the same way the
 * unsubscribe itself is — the user id + unsubscribe token from the email
 * link must match. No new data.
 */
export async function resubscribe(userId: string, token: string): Promise<{ error?: string }> {
  const { data, error } = await createServiceClient()
    .from("profiles")
    .update({ email_notifications_enabled: true })
    .eq("id", userId)
    .eq("unsubscribe_token", token)
    .select("id");
  if (error || !data?.length) return { error: "Couldn't undo that. Try the link again." };
  return {};
}
