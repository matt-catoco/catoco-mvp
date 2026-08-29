import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing. Supabase redirects here with `?code=...`; we exchange it
 * for a session, then decide where the user goes:
 *   - no profile display_name yet  -> /onboarding/profile (first login)
 *   - display_name already set     -> straight to `next`
 *
 * Uses relative `redirect()` so it works on any host without trusting
 * `request.url`'s protocol (unreliable inside route handlers).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // Only allow relative in-app paths as the post-login destination.
  const nextParam = searchParams.get("next") ?? "/trips";
  const next = nextParam.startsWith("/") ? nextParam : "/trips";

  if (!code) {
    redirect("/sign-in?error=missing_code");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    redirect("/sign-in?error=exchange_failed");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in?error=no_user");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  if (!profile?.display_name) {
    redirect(`/onboarding/profile?next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}
