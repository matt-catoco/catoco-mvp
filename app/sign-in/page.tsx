"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { requestMagicLink } from "./actions";
import {
  AuthCard,
  AuthHeading,
  AuthIcon,
  Wordmark,
  authButton,
  authError,
  authField,
  authGhostButton,
  authLabel,
} from "@/components/auth-ui";

// app/auth/callback redirects here with ?error=… when a magic link can't be
// exchanged (expired or already used) — show "Link expired" instead of the
// form. Redirect behavior itself is unchanged.
const LINK_ERRORS = new Set(["exchange_failed", "missing_code", "no_user"]);

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = params.get("trip_id");
  // Direct path (homepage sign-up) has no `next` — default to the dashboard.
  const next = params.get("next") ?? "/trips";
  const linkError = LINK_ERRORS.has(params.get("error") ?? "");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const { error } = await requestMagicLink(email, tripId, next);

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    router.push(`/sign-in/check-email?email=${encodeURIComponent(email)}`);
  }

  if (linkError) {
    const retry = new URLSearchParams();
    if (tripId) retry.set("trip_id", tripId);
    if (params.get("next")) retry.set("next", next);
    const qs = retry.toString();
    return (
      <AuthCard label="Link expired">
        <AuthIcon icon="alert" tone="error" />
        <AuthHeading>Link expired</AuthHeading>
        <Link href={`/sign-in${qs ? `?${qs}` : ""}`} className={authGhostButton}>
          Sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard label="Sign in">
      <Wordmark />
      <AuthHeading>Sign in</AuthHeading>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="sign-in-email" className={authLabel}>
            Email
          </label>
          <input
            id="sign-in-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={authField}
          />
        </div>
        <button type="submit" disabled={status === "sending"} className={authButton}>
          {status === "sending" ? "Sending…" : "Continue"}
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

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
