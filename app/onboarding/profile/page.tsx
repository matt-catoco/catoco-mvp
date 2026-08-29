"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function ProfileForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/trips";
  const safeNext = next.startsWith("/") ? next : "/trips";

  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/sign-in");
      return;
    }

    // RLS: "Users can update their own profile" (auth.uid() = id).
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("id", user.id);

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }

    router.push(safeNext);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          What should we call you?
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This is the name other people in your trips will see.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <input
            type="text"
            required
            autoFocus
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="h-11 rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.4] dark:border-white/[.16] dark:focus:border-white/[.4]"
          />
          <button
            type="submit"
            disabled={status === "saving" || displayName.trim().length === 0}
            className="h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Continue"}
          </button>
        </form>

        {status === "error" && (
          <p className="mt-3 text-sm text-red-500">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}

export default function OnboardingProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileForm />
    </Suspense>
  );
}
