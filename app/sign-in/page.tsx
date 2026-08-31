"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = params.get("trip_id");
  // Direct path (homepage sign-up) has no `next` — default to the dashboard.
  const next = params.get("next") ?? "/trips";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          next,
        )}`,
        // Read by the handle_new_user() DB trigger. Supabase only applies this
        // when a brand-new user is created, so re-invites don't overwrite it.
        data: tripId ? { invited_via_trip_id: tripId } : undefined,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }

    router.push(`/sign-in/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sign in to Cataco
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          We&apos;ll email you a magic link — no password needed.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-11 rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.4] dark:border-white/[.16] dark:focus:border-white/[.4]"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
        </form>

        {status === "error" && (
          <p className="mt-3 text-sm text-red-500">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
