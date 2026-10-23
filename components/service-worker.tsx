"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which only shows the offline page when a page load
 * fails for lack of network (it caches no app content). Production builds
 * only, so local development never runs a stale worker.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: the site works the same without it.
    });
  }, []);
  return null;
}
