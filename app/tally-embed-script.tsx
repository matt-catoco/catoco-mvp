"use client";

import Script from "next/script";

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void };
  }
}

/**
 * Loads Tally's embed script and explicitly swaps `data-tally-src` iframes
 * over to `src`. Tally's script only does this in response to its own
 * load/DOMContentLoaded listeners, which have typically already fired by the
 * time a next/script "afterInteractive" tag attaches — so without this
 * onLoad call the iframe never loads. Mirrors the loader in the original
 * design-handoff HTML file.
 */
export function TallyEmbedScript() {
  return (
    <Script
      src="https://tally.so/widgets/embed.js"
      strategy="afterInteractive"
      onLoad={() => {
        if (typeof window.Tally !== "undefined") {
          window.Tally.loadEmbeds();
        } else {
          document
            .querySelectorAll<HTMLIFrameElement>(
              "iframe[data-tally-src]:not([src])",
            )
            .forEach((el) => {
              el.src = el.dataset.tallySrc ?? "";
            });
        }
      }}
    />
  );
}
