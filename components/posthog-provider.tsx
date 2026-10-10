"use client";

import { Suspense, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";

/**
 * PostHog (EU cloud) with consent gating (founder spec, 2026-10-10).
 *  - No NEXT_PUBLIC_POSTHOG_KEY (Preview/staging — the key is
 *    Production-only) → PostHog is never loaded: no calls, no banner.
 *  - PostHog is not even initialised until the visitor accepts. (Tested:
 *    posthog.init() fetches remote config from PostHog straight away, even
 *    with capturing opted out — that would contact PostHog before consent.)
 *    The choice itself is kept in a tiny local preference (granted/denied).
 *  - Every event's URLs are reduced to origin + path (no query string, no
 *    hash) — covers tokens like /unsubscribe?t=…, autocapture included.
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
const CONSENT_KEY = "catoco:analytics-consent";

/** origin + pathname only. A path-embedded token would need a rule here. */
export function sanitizeUrl(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return raw;
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0];
  }
}

function scrub(obj: Record<string, unknown> | undefined | null) {
  if (!obj) return;
  for (const k of Object.keys(obj)) {
    if (/(url|referrer)$/i.test(k)) obj[k] = sanitizeUrl(obj[k]);
  }
}

type Consent = "granted" | "denied" | "pending";

function readConsent(): Consent {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : "pending";
  } catch {
    return "pending";
  }
}
function writeConsent(c: "granted" | "denied") {
  try {
    window.localStorage.setItem(CONSENT_KEY, c);
  } catch {
    // storage blocked: the choice holds for this page view only
  }
}

let initialised = false;
function initPostHog() {
  if (!KEY || initialised) return;
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: "identified_only",
    capture_pageview: false, // manual + sanitised — see PageviewTracker
    before_send: (event) => {
      if (!event) return event;
      scrub(event.properties as Record<string, unknown>);
      scrub(event.$set as Record<string, unknown> | undefined);
      scrub(event.$set_once as Record<string, unknown> | undefined);
      return event;
    },
  });
  initialised = true;
}

function capturePageview() {
  if (!initialised) return;
  posthog.capture("$pageview", { $current_url: sanitizeUrl(window.location.href) });
}

/** consent is null until the stored choice has been read (no banner flash). */
const AnalyticsContext = createContext<{ enabled: boolean; consent: Consent | null; setConsent: (c: "granted" | "denied") => void }>({
  enabled: false,
  consent: null,
  setConsent: () => {},
});
export const useAnalytics = () => useContext(AnalyticsContext);

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    capturePageview();
  }, [pathname, searchParams]);
  return null;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const enabled = Boolean(KEY);
  const [consent, setConsentState] = useState<Consent | null>(null); // null = not read yet

  useEffect(() => {
    if (!KEY) return;
    const c = readConsent();
    if (c === "granted") initPostHog(); // PageviewTracker then sends the first pageview
    // The stored choice only exists client-side.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsentState(c);
  }, []);

  function setConsent(c: "granted" | "denied") {
    writeConsent(c);
    if (c === "granted") {
      initPostHog(); // PageviewTracker mounts next and sends this route's pageview
    } else if (initialised) {
      posthog.opt_out_capturing();
    }
    setConsentState(c);
  }

  return (
    <AnalyticsContext.Provider value={{ enabled, consent, setConsent }}>
      {enabled && consent === "granted" && (
        <Suspense fallback={null}>
          <PageviewTracker />
        </Suspense>
      )}
      {children}
    </AnalyticsContext.Provider>
  );
}
