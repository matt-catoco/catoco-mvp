"use server";

import { createClient } from "@/lib/supabase/server";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { CHANNEL_PREFERENCES, type ChannelPreference } from "@/lib/push/channels";

/** Kinds a person can set: the ones with a label (pending-approval kinds have none yet). */
const SETTABLE = new Set(Object.keys(dictionaries.en.push.labels));

/** Save one kind's channel; "default" removes the override. RLS: own rows only. */
export async function setNotificationPreference(kind: string, channel: ChannelPreference | "default"): Promise<{ error?: string }> {
  if (!SETTABLE.has(kind)) return { error: "unknown kind" };
  if (channel !== "default" && !CHANNEL_PREFERENCES.includes(channel)) return { error: "unknown channel" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not signed in" };

  const { error } =
    channel === "default"
      ? await supabase.from("notification_preferences").delete().eq("user_id", user.id).eq("kind", kind)
      : await supabase
          .from("notification_preferences")
          .upsert({ user_id: user.id, kind, channel, updated_at: new Date().toISOString() }, { onConflict: "user_id,kind" });
  return error ? { error: error.message } : {};
}
