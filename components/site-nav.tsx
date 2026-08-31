import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoMark } from "./logo-mark";
import { SignOutButton } from "./sign-out-button";

/**
 * Persistent app-wide nav — present on every route including the marketing
 * homepage (rendered in app/layout.tsx above {children}), separate from the
 * homepage's own marketing header (How it works / The elements / Join the
 * beta), which stays as-is. This bar is purely about getting into and out of
 * the app: the mark, My Trips when signed in, sign in/out. No dropdown, no
 * avatar, no notifications — that's explicitly out of scope for MVP.
 *
 * The mark always links to "/" (marketing home), signed in or not — that's
 * the one thing this nav previously got wrong: it sent signed-in users to
 * /trips, so there was no way back to "/" at all once signed in. "My Trips"
 * is its own separate link, so from a trip page both Home and My Trips are
 * one click away. Sign out stays (sessions are persistent cookies, not
 * cleared on browser close, so there needs to be a real way to end one) but
 * kept visually secondary — smaller and quieter than the primary links.
 *
 * Reuses the same server-side auth check every authed page already uses
 * (createClient() + auth.getUser()) rather than inventing a second pattern.
 */
export async function SiteNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-black/[.08] dark:border-white/[.12]">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold text-black dark:text-zinc-50"
        >
          <span className="h-5 w-5">
            <LogoMark />
          </span>
          cataco
        </Link>

        <div className="flex items-center gap-5">
          {user ? (
            <>
              <Link
                href="/trips"
                className="text-sm font-medium text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                My Trips
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/sign-in"
              className="text-sm font-medium text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
