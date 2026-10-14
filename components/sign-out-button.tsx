"use client";

import { forwardRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Sign out. Used as a menu item in the account menu (role/className passed in). */
export const SignOutButton = forwardRef<
  HTMLButtonElement,
  { className?: string; role?: string; tabIndex?: number; icon?: ReactNode }
>(function SignOutButton({ className, role, tabIndex, icon }, ref) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    });
  }

  return (
    <button
      ref={ref}
      type="button"
      role={role}
      tabIndex={tabIndex}
      onClick={handleSignOut}
      disabled={pending}
      className={
        className ??
        "text-sm font-medium text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-400"
      }
    >
      {icon}
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
});
