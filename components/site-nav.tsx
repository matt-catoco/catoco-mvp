import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AccountMenu, MyTripsLink } from "./account-menu";

/**
 * Persistent app-wide nav — on every route except the marketing homepage
 * (each subtree's layout adds it), separate from the homepage's own
 * marketing header. Getting into and out of the app: the wordmark (always
 * links to "/", signed in or not), "My trips" (teal underline when current)
 * and, signed in, an initials avatar with the account menu — name and
 * email, Profile, Sign out ("Getting In" restyle, 2026-10-14; Email
 * notifications deliberately not in the menu yet).
 *
 * Reuses the same server-side auth check every authed page already uses
 * (createClient() + auth.getUser()) rather than inventing a second pattern.
 */
export async function SiteNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
    : { data: null };

  const focusRing =
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

  return (
    <header className="border-b border-brand-line bg-background">
      <nav aria-label="Main" className="mx-auto flex h-[60px] w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className={`rounded-sm font-[family-name:var(--font-display)] text-[22px] font-bold tracking-[-0.02em] text-foreground ${focusRing}`}
        >
          catoco
        </Link>

        <div className="flex h-full items-center gap-5 sm:gap-6">
          {user ? (
            <>
              <MyTripsLink />
              <AccountMenu name={(profile?.display_name as string | null) ?? ""} email={user.email ?? ""} />
            </>
          ) : (
            <Link
              href="/sign-in"
              className={`text-sm font-medium text-brand-muted hover:text-foreground ${focusRing} rounded-sm`}
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
