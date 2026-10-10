"use client";

import Link from "next/link";
import { useAnalytics } from "./posthog-provider";

/**
 * Analytics consent. Shown only when analytics is configured (Production)
 * and no decision has been recorded yet. Accept and Decline are equal
 * choices. Wording is a neutral placeholder pending legal review.
 */
export function CookieBanner() {
  const { enabled, consent, setConsent } = useAnalytics();
  if (!enabled || consent !== "pending") return null;
  const btn = "h-9 rounded-lg border px-4 text-xs font-medium transition-colors";
  return (
    <div
      role="dialog"
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border-2 border-brand-line bg-background p-4 text-left text-xs shadow-lg sm:flex-row sm:items-center"
    >
      <p className="flex-1 text-brand-muted">
        We&apos;d like to use analytics cookies (PostHog, hosted in the EU) to understand how Catoco is used. They&apos;re
        only set if you accept.{" "}
        <Link href="/privacy" className="underline">
          Privacy policy
        </Link>
      </p>
      <div className="flex gap-2">
        <button type="button" className={`${btn} border-brand-line hover:border-foreground`} onClick={() => setConsent("denied")}>
          Decline
        </button>
        <button type="button" className={`${btn} border-foreground bg-foreground text-background hover:opacity-90`} onClick={() => setConsent("granted")}>
          Accept
        </button>
      </div>
    </div>
  );
}
