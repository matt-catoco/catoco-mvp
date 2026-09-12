import "server-only";
import type { VendorSearchParams, VendorSearchResponse, VendorSearchResult } from "./types";

// Viator Partner API — the one vendor confirmed live this pass (Experiences).
// Uses the free-text search endpoint (searches by place/activity name
// directly) rather than pre-resolving a Viator destination ID via their
// /destinations endpoint — simpler for a first pass, and destination-ID
// resolution can be layered in later if free-text search proves too broad.
//
// Verified against a real sandbox call (searchTerm "Paris") with key #B5B1
// — response shape matches what's read below (products.results[], each with
// productCode/title/description/images[].variants[]/pricing.summary.
// fromPrice/pricing.currency/productUrl/duration). One thing the docs
// didn't make obvious: the request needs a top-level `currency` field or it
// 400s with "Missing currency" — included below.
const VIATOR_BASE = "https://api.sandbox.viator.com/partner";

type ViatorProduct = {
  productCode?: string;
  title?: string;
  description?: string;
  productUrl?: string;
  images?: { variants?: { url?: string; width?: number }[] }[];
  pricing?: { summary?: { fromPrice?: number }; currency?: string };
  duration?: {
    fixedDurationInMinutes?: number;
    variableDurationFromMinutes?: number;
    variableDurationToMinutes?: number;
  };
};

/**
 * "~3–3.5 hours" / "~2 hours" — approximate is the point here (see the
 * founder review flagged in catoco-element-search-handoff-notes.md): a
 * search result is a candidate to compare, not a booked itinerary, so a
 * duration RANGE reads more honestly than a specific start time would.
 */
function formatDuration(d: ViatorProduct["duration"]): string | undefined {
  if (!d) return undefined;
  const toHours = (min: number) => {
    const hours = min / 60;
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  };
  if (d.variableDurationFromMinutes && d.variableDurationToMinutes) {
    return `~${toHours(d.variableDurationFromMinutes)}–${toHours(d.variableDurationToMinutes)} hours`;
  }
  if (d.fixedDurationInMinutes) {
    const hours = toHours(d.fixedDurationInMinutes);
    return `~${hours} ${hours === "1" ? "hour" : "hours"}`;
  }
  if (d.variableDurationFromMinutes) return `~${toHours(d.variableDurationFromMinutes)}+ hours`;
  return undefined;
}

export async function viatorSearch(params: VendorSearchParams): Promise<VendorSearchResponse> {
  const apiKey = process.env.VIATOR_API_KEY;
  if (!apiKey) {
    // No key configured — degrade to the same mock/empty shape rather than
    // throw, so a missing env var reads as "nothing found" not a crash.
    return { status: "mock", vendorLabel: "Mock data — Viator key not configured", results: [] };
  }

  const searchTerm = (params.location || params.destination || "").trim();
  if (!searchTerm) {
    return { status: "live", vendorLabel: "Viator", results: [] };
  }

  const res = await fetch(`${VIATOR_BASE}/search/freetext`, {
    method: "POST",
    headers: {
      "exp-api-key": apiKey,
      Accept: "application/json;version=2.0",
      "Accept-Language": "en-US",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      searchTerm,
      currency: "USD", // required — a bare search request 400s without it ("Missing currency"), confirmed against the live sandbox
      productFiltering: {},
      searchTypes: [{ searchType: "PRODUCTS", pagination: { start: 1, count: 12 } }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Viator search failed (${res.status})`);
  }

  const data = await res.json();
  const products: ViatorProduct[] =
    data?.products?.results ?? data?.products ?? [];

  const results: VendorSearchResult[] = products.map((p, i) => {
    const thumb = p.images?.[0]?.variants?.find((v) => (v.width ?? 0) >= 400)?.url ?? p.images?.[0]?.variants?.[0]?.url;
    const duration = formatDuration(p.duration);
    return {
      id: p.productCode ?? `viator-${i}`,
      title: p.title ?? "Untitled experience",
      // Duration leads — it's what actually differentiates candidates at a
      // glance, same reasoning as Flight results leading with flight
      // number/times. The result card truncates to one line, so it has to
      // be first to survive that.
      description: duration ? [duration, p.description].filter(Boolean).join(" · ") : p.description,
      thumbnail_url: thumb,
      booking_link: p.productUrl,
      price: p.pricing?.summary?.fromPrice,
      currency: p.pricing?.currency ?? "USD",
      pricing_basis: "per_person",
      // Carried onto the locked option's value for display/context (the
      // group size someone actually searched with) — NOT sent to Viator as
      // a search filter. /search/freetext's ProductFiltering has no
      // traveler-count parameter; real pax-aware pricing/availability on
      // Viator's API lives behind their per-product Availability Check,
      // called with a specific product code + travelers breakdown, not a
      // search-time filter. `fromPrice` here is always Viator's own
      // "starting from" indicative price regardless of party size — a
      // deeper integration (checking each candidate's real availability
      // for the actual group) is future scope, not something this search
      // step can honestly claim to reflect today.
      //
      // date: same story as travelers — the Date someone actually searched
      // with, carried onto the selected option so it survives past this
      // search (Viator's free-text search has no date filter either, so
      // this doesn't affect which results come back). No `time` here on
      // purpose — the search form doesn't collect one (see the modal's own
      // note); duration is the honest pre-vote signal instead.
      extra: { travelers: params.travelers, date: params.startDate },
    };
  });

  return { status: "live", vendorLabel: "Viator", results };
}
