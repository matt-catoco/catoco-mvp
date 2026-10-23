import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getDictionary } from "@/lib/i18n/server";
import type { ChannelPreference } from "@/lib/push/channels";
import { ProfileForm } from "./profile-form";
import { NotificationPrefs } from "./notification-prefs";

/** Account menu → Profile: edit your display name (the name others see). */
export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent("/profile")}`);

  const [{ data: profile }, { count: devices }, { data: prefs }, { t }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    // push_devices is service-role only; count this person's active devices.
    createServiceClient()
      .from("push_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("revoked_at", null),
    supabase.from("notification_preferences").select("kind, channel"),
    getDictionary(),
  ]);
  const initial = Object.fromEntries(
    ((prefs ?? []) as { kind: string; channel: ChannelPreference }[]).map((p) => [p.kind, p.channel]),
  );

  return (
    <ProfileForm initialName={(profile?.display_name as string | null) ?? ""} email={user.email ?? ""}>
      {(devices ?? 0) > 0 && <NotificationPrefs t={t.push} initial={initial} />}
    </ProfileForm>
  );
}
