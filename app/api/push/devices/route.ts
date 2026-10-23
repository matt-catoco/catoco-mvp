import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validToken, validateRegistration } from "@/lib/push/devices";

// Device registration for push (three-prong Prompt 4, 2026-10-23). The app
// (prompt C) calls POST after the person grants permission and on every
// token refresh, and DELETE on sign-out. The session decides whose device
// it is; the table itself is service-role only.

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });

  const reg = validateRegistration(await request.json().catch(() => null));
  if (!reg) return Response.json({ error: "invalid device" }, { status: 400 });

  // A token belongs to one device; if someone else signed in on it before,
  // it moves to this person.
  const { error } = await createServiceClient()
    .from("push_devices")
    .upsert(
      {
        user_id: userId,
        platform: reg.platform,
        token: reg.token,
        app_version: reg.appVersion,
        locale: reg.locale,
        time_zone: reg.timeZone,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
        revoked_reason: null,
      },
      { onConflict: "token" },
    );
  if (error) {
    console.error("push device register failed:", error.message);
    return Response.json({ error: "could not register" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = validToken(body?.token);
  if (!token) return Response.json({ error: "invalid token" }, { status: 400 });

  const { error } = await createServiceClient()
    .from("push_devices")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "signed_out" })
    .eq("token", token)
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) {
    console.error("push device unregister failed:", error.message);
    return Response.json({ error: "could not unregister" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
