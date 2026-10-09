/**
 * Staging review B3 (founder, 2026-10-09): every option carries the details
 * a participant needs to compare it at the vote, fund it, and later actually
 * show up — address, contact, check-in, cancellation, what's included,
 * flight legs, baggage. Fetched once per option at submission (vendor API
 * data when the option came from a vendor search, otherwise schema.org
 * JSON-LD + Open Graph from the booking link) and stored on the option as
 * `value.details`. When the element locks, the winner's details (plus its
 * element-level photo) are snapshotted onto trip_elements.enriched_details
 * as the lasting reference. Coverage differs by source — every field is
 * optional, and a plain scraped page may only ever yield an address.
 *
 * Client-safe: types + display helpers only. Fetching lives in
 * lib/option-details-fetch.ts (server-only).
 */

export type FlightSegment = {
  from: string;
  to: string;
  depart: string;
  arrive: string;
  carrier?: string;
  flight?: string;
};

export type OptionDetails = {
  source: "liteapi" | "viator" | "duffel" | "page";
  fetched_at: string;
  summary?: string;
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  email?: string;
  website?: string;
  rating?: string;
  checkin?: string;
  checkout?: string;
  duration?: string;
  meeting_point?: string;
  cancellation?: string;
  policies?: string[];
  inclusions?: string[];
  exclusions?: string[];
  supplier?: string;
  segments?: FlightSegment[];
  baggage?: string;
  images?: string[];
};

/** The element-level photo shown once locked (Destination: always). */
export type ElementImage = {
  url: string;
  source: "option" | "vendor" | "unsplash" | "url";
  credit_name?: string;
  credit_url?: string;
};

/** trip_elements.enriched_details — the lock-time snapshot. */
export type EnrichedDetails = {
  details: OptionDetails | null;
  image: ElementImage | null;
  enriched_at: string;
};

export function readDetails(value: Record<string, unknown> | null | undefined): OptionDetails | null {
  const d = value?.details;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as OptionDetails) : null;
}

function segmentLine(s: FlightSegment): string {
  const time = (iso: string) => {
    const t = iso.slice(11, 16);
    return t || iso;
  };
  const flight = [s.carrier, s.flight].filter(Boolean).join(" ");
  return `${s.from} ${time(s.depart)} → ${s.to} ${time(s.arrive)}${flight ? ` · ${flight}` : ""}`;
}

/** Display order of detail rows — shared by the locked view and the vote's comparison table. */
export const DETAIL_ORDER = [
  "rating", "duration", "segments", "baggage", "checkin", "checkout", "address", "meeting_point",
  "cancellation", "inclusions", "exclusions", "policies", "supplier", "phone", "email", "website",
] as const;

/**
 * Labelled rows for display (locked view, comparison table). One place
 * decides labels and ordering so the vote and the reference view agree.
 */
export function detailRows(d: OptionDetails | null): { key: string; label: string; value: string }[] {
  if (!d) return [];
  const rows: { key: string; label: string; value: string }[] = [];
  const add = (key: string, label: string, value: string | undefined | null) => {
    if (value && value.trim()) rows.push({ key, label, value: value.trim() });
  };
  add("rating", "Rating", d.rating);
  add("duration", "Duration", d.duration);
  if (d.segments?.length) add("segments", "Flights", d.segments.map(segmentLine).join("\n"));
  add("baggage", "Baggage", d.baggage);
  add("checkin", "Check-in", d.checkin);
  add("checkout", "Check-out", d.checkout);
  add("address", "Address", d.address);
  add("meeting_point", "Meeting point", d.meeting_point);
  add("cancellation", "Cancellation", d.cancellation);
  if (d.inclusions?.length) add("inclusions", "Included", d.inclusions.join(" · "));
  if (d.exclusions?.length) add("exclusions", "Not included", d.exclusions.join(" · "));
  if (d.policies?.length) add("policies", "Good to know", d.policies.join("\n"));
  add("supplier", "Operated by", d.supplier);
  add("phone", "Phone", d.phone);
  add("email", "Email", d.email);
  add("website", "Website", d.website);
  return rows;
}

/** A Google Maps link for an address or coordinates — opened, never embedded. */
export function mapsLink(d: OptionDetails | null): string | null {
  if (!d) return null;
  if (typeof d.lat === "number" && typeof d.lng === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`;
  }
  if (d.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`;
  return null;
}
