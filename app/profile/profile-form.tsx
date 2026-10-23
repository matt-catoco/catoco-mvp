"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, AuthHeading, AuthText, authButton, authError, authField, authLabel } from "@/components/auth-ui";

/**
 * Same save path as onboarding/profile: a direct update under RLS
 * ("Users can update their own profile", auth.uid() = id) — no new server code.
 */
export function ProfileForm({ initialName, email, children }: { initialName: string; email: string; children?: ReactNode }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
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
    const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() }).eq("id", user.id);
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }
    setStatus("saved");
    router.refresh(); // the nav's initials and menu name
  }

  return (
    <AuthCard label="Profile">
      <AuthHeading>Profile</AuthHeading>
      <AuthText>
        Signed in as <span className="break-all font-semibold text-foreground">{email}</span>
      </AuthText>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="profile-name" className={authLabel}>
            Display name
          </label>
          <input
            id="profile-name"
            type="text"
            required
            autoComplete="name"
            maxLength={80}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (status === "saved") setStatus("idle");
            }}
            className={authField}
          />
        </div>
        <button
          type="submit"
          disabled={status === "saving" || displayName.trim().length === 0 || displayName.trim() === initialName.trim()}
          className={authButton}
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </form>
      {status === "saved" && (
        <p role="status" className="text-sm text-brand-muted">
          Saved.
        </p>
      )}
      {status === "error" && (
        <p role="alert" className={authError}>
          {errorMsg}
        </p>
      )}
      {children}
    </AuthCard>
  );
}
