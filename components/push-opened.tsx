"use client";

import { useEffect } from "react";
import { trackEvent } from "@/components/posthog-provider";

/**
 * Push deep links arrive as <path>?n=<kind> (lib/notifications.ts sendPush).
 * Records push_opened (kind only, consent-gated like every event) and tidies
 * the URL.
 */
export function PushOpened() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const kind = url.searchParams.get("n");
    if (!kind || !/^[a-z_]{3,40}$/.test(kind)) return;
    trackEvent("push_opened", { kind });
    url.searchParams.delete("n");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return null;
}
