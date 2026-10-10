import { LINK_COVERAGE_LABEL, PROVIDERS, providerForOption, type LinkCoverage, type ProviderKey } from "@/lib/providers";

export type BookingLink = {
  provider: ProviderKey;
  providerLabel: string;
  url: string | null;
  coverage: LinkCoverage;
  coverageLabel: string;
};

/**
 * The "open the vendor" step on Ready to Book. Uses every parameter the
 * vendor is CONFIRMED to support — nothing guessed. Today that means:
 *  - Viator: the product URL from their API already carries our affiliate
 *    ids (mcid/pid); date/party params aren't confirmed, so not added.
 *  - Hand-added options: the pasted link, as-is.
 *  - LiteAPI / Duffel: API-only, no consumer page.
 * Coverage is reported honestly from lib/providers.ts.
 */
export function bookingLinkFor(value: Record<string, unknown>): BookingLink {
  const provider = providerForOption(value);
  const cfg = PROVIDERS[provider];
  const raw = typeof value.booking_link === "string" ? value.booking_link.trim() : "";
  let url: string | null = null;
  if (raw && cfg.linkCoverage !== "none") {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || u.protocol === "http:") url = u.toString();
    } catch {
      url = null;
    }
  }
  const coverage: LinkCoverage = url ? cfg.linkCoverage : "none";
  return {
    provider,
    providerLabel: cfg.label,
    url,
    coverage,
    coverageLabel:
      coverage === "none" && provider === "manual" ? "No booking link was added with this option" : LINK_COVERAGE_LABEL[coverage],
  };
}
