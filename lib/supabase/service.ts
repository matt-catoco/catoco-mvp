import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS entirely. Only for the
 * notifications cron route (app/api/cron/notifications/route.ts), which
 * needs to read across every trip/user, not the current request's own.
 * Never import this from anything client-reachable; SUPABASE_SERVICE_ROLE_KEY
 * must never end up in the browser bundle. No cookie/session handling needed
 * (unlike lib/supabase/server.ts/client.ts) — the key itself is the auth.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
