"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, AuthHeading, authButton, authError, authField, authLabel } from "@/components/auth-ui";

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
    <AuthCard label="Your name">
      <AuthHeading>Your name</AuthHeading>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="display-name" className={authLabel}>
            Display name
          </label>
          <input
            id="display-name"
            type="text"
            required
            autoFocus
            autoComplete="name"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className={authField}
          />
        </div>
        <button
          type="submit"
          disabled={status === "saving" || displayName.trim().length === 0}
          className={authButton}
        >
          {status === "saving" ? "Saving…" : "Continue"}
        </button>
      </form>
      {status === "error" && (
        <p role="alert" className={authError}>
          {errorMsg}
        </p>
      )}
    </AuthCard>
  );
}

export default function OnboardingProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileForm />
    </Suspense>
  );
}
