import { isStockPhoto, readDetails } from "@/lib/option-details";
import {
  ACCOMMODATION_SUBTYPE_LABELS,
  EXPERIENCE_SUBTYPE_LABELS,
  PRICE_BEARING_TYPES,
  PRICING_BASIS_LABELS,
  TRAVEL_MODE_LABELS,
  describeDates,
  formatCurrency,
  formatDate,
  nightsBetween,
  summarizeOptionValue,
  type AccommodationSubtype,
  type ElementType,
  type ExperienceSubtype,
  type PricingBasis,
  type TravelMode,
  type TravelersBreakdown,
} from "@/lib/trip-elements";
import { UNSPLASH_UTM_SOURCE } from "@/lib/trip-icons";

export function priceLine(value: Record<string, unknown>): string | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const currency = typeof value.currency === "string" && value.currency ? value.currency : "USD";
  const amount = Number(raw);
  const money = Number.isFinite(amount) ? formatCurrency(amount, currency) : `${currency} ${raw}`;
  // Dining: a price is only ever a required deposit (the rest is paid at the venue).
  return value.deposit_required === true ? `Deposit ${money}` : money;
}

function formatTravelersShort(t: TravelersBreakdown): string {
  const parts = [`${t.adults} adult${t.adults === 1 ? "" : "s"}`];
  const children = t.children_ages?.length ?? 0;
  if (children) parts.push(`${children} child${children === 1 ? "" : "ren"}`);
  const infants = t.infants_ages?.length ?? 0;
  if (infants) parts.push(`${infants} infant${infants === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/**
 * A voter has to open the listing today to see anything past title/price —
 * this is the structured data the submission/search flow already collects
 * (dates, traveler counts, mode/subtype) surfaced right on the card instead,
 * so comparing candidates doesn't require leaving the voting grid. Display-
 * only: reads straight off `value`, nothing new collected or stored.
 */
export function keyFactsLine(type: ElementType, value: Record<string, unknown>): string | null {
  const str = (k: string) => (typeof value[k] === "string" ? (value[k] as string).trim() : "");
  const parts: string[] = [];

  switch (type) {
    case "travel": {
      const mode = str("mode");
      if (mode) parts.push(TRAVEL_MODE_LABELS[mode as TravelMode] ?? mode);
      const depart = str("depart_date") || str("pickup_datetime");
      const ret = str("return_date") || str("dropoff_datetime");
      if (depart) {
        parts.push(ret && ret !== depart ? `${formatDate(depart)} → ${formatDate(ret)}` : formatDate(depart));
        if (mode !== "rental_car") parts.push(value.round_trip === false ? "One-way" : "Round trip");
      }
      break;
    }
    case "accommodation": {
      const subtype = str("subtype");
      if (subtype) parts.push(ACCOMMODATION_SUBTYPE_LABELS[subtype as AccommodationSubtype] ?? subtype);
      const dates = (value.dates ?? {}) as Record<string, unknown>;
      const start = typeof dates.start_date === "string" ? dates.start_date.trim() : "";
      const end = typeof dates.end_date === "string" ? dates.end_date.trim() : "";
      if (start) parts.push(end ? `${formatDate(start)} → ${formatDate(end)}` : formatDate(start));
      const nights = start && end ? nightsBetween(start, end) : null;
      if (nights) parts.push(`${nights} night${nights === 1 ? "" : "s"}`);
      if (value.travelers && typeof value.travelers === "object") {
        parts.push(formatTravelersShort(value.travelers as TravelersBreakdown));
      }
      break;
    }
    case "experience": {
      const subtype = str("experience_subtype");
      if (subtype) parts.push(EXPERIENCE_SUBTYPE_LABELS[subtype as ExperienceSubtype] ?? subtype);
      const date = str("date");
      const time = str("time");
      if (date) parts.push(time ? `${formatDate(date)} · ${time}` : formatDate(date));
      if (value.travelers && typeof value.travelers === "object") {
        parts.push(formatTravelersShort(value.travelers as TravelersBreakdown));
      }
      break;
    }
    case "dining": {
      const date = str("date");
      const time = str("dining_time");
      if (date) parts.push(time ? `${formatDate(date)} · ${time}` : formatDate(date));
      if (typeof value.guests === "number") {
        parts.push(`${value.guests} guest${value.guests === 1 ? "" : "s"}`);
      }
      const cuisine = str("cuisine");
      if (cuisine) parts.push(cuisine);
      break;
    }
  }

  return parts.length ? parts.join(" · ") : null;
}

/** Price with its basis — "€45 per person", "€120 per night", "€300 flat". */
export function priceWithBasis(value: Record<string, unknown>): { amount: string; basis: string } | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const currency = typeof value.currency === "string" && value.currency ? value.currency : "USD";
  if (value.deposit_required === true) return { amount: formatCurrency(n, currency), basis: "deposit" };
  const basis = PRICING_BASIS_LABELS[value.pricing_basis as PricingBasis] ?? "";
  return { amount: formatCurrency(n, currency), basis: basis.replace(" (shared cost)", "") };
}

/**
 * Compare-table rows (voting restyle, 2026-10-14): the same facts as
 * keyFactsLine, split into one labelled row each and chosen per type — a
 * Dining compare shows cuisine and meal time, not guests or trip dates.
 * Rows nobody has are dropped by the caller.
 */
export function compareFields(type: ElementType, value: Record<string, unknown>): { key: string; label: string; value: string | null }[] {
  const str = (k: string) => (typeof value[k] === "string" ? (value[k] as string).trim() : "");
  // Time gets its own row (founder, 2026-10-19): it's what decides a flight or a tour.
  const day = (date: string) => (date ? formatDate(date) : null);
  const guests =
    value.travelers && typeof value.travelers === "object" ? formatTravelersShort(value.travelers as TravelersBreakdown) : null;
  switch (type) {
    case "travel": {
      const mode = str("mode");
      const depart = str("depart_date") || str("pickup_datetime");
      const ret = str("return_date") || str("dropoff_datetime");
      return [
        { key: "dates", label: "Dates", value: depart ? (ret && ret !== depart ? `${formatDate(depart)} → ${formatDate(ret)}` : formatDate(depart)) : null },
        {
          key: "time",
          label: "Time",
          value: str("depart_time") ? (str("arrival_time") ? `${str("depart_time")} → ${str("arrival_time")}` : str("depart_time")) : null,
        },
        { key: "guests", label: "Guests", value: guests },
        { key: "mode", label: "Type", value: mode ? (TRAVEL_MODE_LABELS[mode as TravelMode] ?? mode) : null },
        { key: "trip", label: "Trip", value: depart && mode !== "rental_car" ? (value.round_trip === false ? "One-way" : "Round trip") : null },
      ];
    }
    case "accommodation": {
      const subtype = str("subtype");
      const dates = (value.dates ?? {}) as Record<string, unknown>;
      const start = typeof dates.start_date === "string" ? dates.start_date.trim() : "";
      const end = typeof dates.end_date === "string" ? dates.end_date.trim() : "";
      const nights = start && end ? nightsBetween(start, end) : null;
      const range = start ? (end ? `${formatDate(start)} → ${formatDate(end)}` : formatDate(start)) : null;
      return [
        { key: "stay", label: "Dates", value: range && nights ? `${range} · ${nights} night${nights === 1 ? "" : "s"}` : range },
        {
          key: "time",
          label: "Check-in / out",
          value:
            [readDetails(value)?.checkin && `In ${readDetails(value)?.checkin}`, readDetails(value)?.checkout && `out ${readDetails(value)?.checkout}`]
              .filter(Boolean)
              .join(" · ") || null,
        },
        { key: "guests", label: "Guests", value: guests },
        { key: "type", label: "Type", value: subtype ? (ACCOMMODATION_SUBTYPE_LABELS[subtype as AccommodationSubtype] ?? subtype) : null },
        { key: "location", label: "Location", value: str("location_name") || null },
      ];
    }
    case "experience": {
      const subtype = str("experience_subtype");
      return [
        { key: "when", label: "Date", value: day(str("date")) },
        { key: "time", label: "Time", value: str("time") || null },
        { key: "guests", label: "Guests", value: guests },
        { key: "category", label: "Type", value: subtype ? (EXPERIENCE_SUBTYPE_LABELS[subtype as ExperienceSubtype] ?? subtype) : null },
        { key: "location", label: "Location", value: str("location_name") || null },
      ];
    }
    case "dining":
      return [
        { key: "cuisine", label: "Cuisine", value: str("cuisine") || null },
        { key: "meal", label: "Date", value: day(str("date")) },
        { key: "time", label: "Time", value: str("dining_time") || null },
        { key: "price_tier", label: "Price range", value: str("price_tier") || null },
        { key: "location", label: "Location", value: str("location_name") || null },
      ];
    default:
      return [];
  }
}

/** A real photo for a non-Destination option (vendor/scraped, never stock), else null. */
export function optionThumbnail(type: ElementType, value: Record<string, unknown>): string | null {
  const raw = typeof value.thumbnail_url === "string" ? value.thumbnail_url.trim() : "";
  if (!raw) return null;
  return type === "destination" || !isStockPhoto(raw, value.thumbnail_credit as { name?: string } | undefined) ? raw : null;
}

/** Option name for a tile/column header. */
export function optionTitle(type: ElementType, value: Record<string, unknown>): string {
  return (
    (typeof value.title === "string" && value.title.trim()) ||
    (typeof value.name === "string" && value.name.trim()) ||
    summarizeOptionValue(type, value)
  );
}

/**
 * Resolved coordinates for an option, if it has any. Verified per type
 * against the value shapes (lib/trip-elements.ts / element-value-fields):
 * Destination stores `lat`/`lng` (place-picker); Experience and Dining store
 * `location_lat`/`location_lng`. Travel and Accommodation carry no pin, and
 * vendor-search results don't set coordinates — those simply get no map.
 * Zoom is per type: a destination is a city/region, the others are a venue.
 */
function mapPoint(type: ElementType, value: Record<string, unknown>): { lat: number; lng: number; z: number } | null {
  const pick = (latKey: string, lngKey: string, z: number) => {
    const lat = Number(value[latKey]);
    const lng = Number(value[lngKey]);
    if (value[latKey] === "" || value[lngKey] === "" || value[latKey] == null || value[lngKey] == null) return null;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, z } : null;
  };
  if (type === "destination") return pick("lat", "lng", 9);
  if (type === "experience" || type === "dining") return pick("location_lat", "location_lng", 13);
  return null;
}

function mapSrc(p: { lat: number; lng: number; z: number }) {
  return `/api/static-map?lat=${p.lat.toFixed(3)}&lng=${p.lng.toFixed(3)}&z=${p.z}`;
}

/**
 * Renders a candidate for comparison — a real card (thumbnail on top, title/
 * description/price below) when the booking link's Open Graph tags came
 * back with anything (lib/link-preview.ts, best-effort), falling back to
 * the plain text summary otherwise. Used everywhere a submitted option is
 * shown to more than its own proposer: the voting grid and the settled/
 * locked value. Sized for a grid cell, not an inline row — callers own the
 * grid/list layout around it.
 */
export function OptionSummary({
  type,
  value,
}: {
  type: ElementType;
  value: Record<string, unknown>;
}) {
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  // Destination shows any photo; other types only a real one — from a vendor
  // API or scraped from the link, never stock (founder, 2026-10-11).
  const rawThumb = typeof value.thumbnail_url === "string" ? value.thumbnail_url.trim() : "";
  const thumbnail =
    rawThumb && (type === "destination" || !isStockPhoto(rawThumb, value.thumbnail_credit as { name?: string } | undefined))
      ? rawThumb
      : "";
  const bookingLink = typeof value.booking_link === "string" ? value.booking_link.trim() : "";
  const price = priceLine(value);
  const fallback = summarizeOptionValue(type, value);
  const facts = PRICE_BEARING_TYPES.includes(type) ? keyFactsLine(type, value) : null;
  const map = mapPoint(type, value);
  const credit = value.thumbnail_credit as { name?: string; url?: string } | undefined;

  // B1: Dates get their own card — the range and night count, big; never
  // a photo or "No image" placeholder (there's nothing to picture).
  if (type === "dates") {
    const d = describeDates(value);
    return (
      <span className="flex flex-col gap-0.5">
        <span className={d.decided ? "block font-medium" : "block font-medium opacity-70"}>{d.range}</span>
        {(d.nightsText || d.flex) && (
          <span className="block text-[11px] opacity-70">
            {[d.nightsText, d.flex ? `±${d.flex} day${d.flex === "1" ? "" : "s"} flexible` : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    );
  }

  const linkLine = bookingLink && (
    <a
      href={bookingLink}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-0.5 block truncate text-[11px] font-medium text-brand-teal-deep underline"
      onClick={(e) => e.stopPropagation()}
    >
      Open listing ↗
    </a>
  );

  // §10: Destination auto-photos from Unsplash (lib/unsplash.ts, applied at
  // submission time in actions.ts' applyLinkPreview) since it has no
  // booking_link to scrape an Open Graph thumbnail from the way the
  // price-bearing types do — explicitly allowed into the rich-card branch
  // below even though it isn't itself price-bearing.
  // A resolved location alone is enough for the rich card — the map fills
  // the image slot when there's no photo.
  if ((!PRICE_BEARING_TYPES.includes(type) && type !== "destination") || (!title && !thumbnail && !map)) {
    return (
      <span className="block">
        {fallback}
        {facts && <span className="mt-0.5 block text-[11px] opacity-70">{facts}</span>}
        {linkLine}
      </span>
    );
  }

  return (
    <span className="flex w-full flex-col gap-2">
      {thumbnail ? (
        <span className="relative block">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external host, next/image would need every domain allowlisted */}
          <img
            src={thumbnail}
            alt=""
            className="h-32 w-full rounded-md bg-black/[.06] object-cover dark:bg-white/[.08]"
          />
          {credit?.name && (
            <span className="absolute bottom-1.5 left-1.5 max-w-[70%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-white">
              <a
                href={`${credit.url ?? "https://unsplash.com"}?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline"
              >
                {credit.name}
              </a>{" "}
              /{" "}
              <a
                href={`https://unsplash.com/?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline"
              >
                Unsplash
              </a>
            </span>
          )}
          {/* Map as a second, smaller element — the photo and the pin say
              different things, so neither replaces the other. */}
          {map && (
            // eslint-disable-next-line @next/next/no-img-element -- same-origin auth-gated proxy (/api/static-map)
            <img
              src={mapSrc(map)}
              alt="Map"
              loading="lazy"
              className="absolute bottom-1.5 right-1.5 h-14 w-14 rounded-md border-2 border-background object-cover shadow-sm"
            />
          )}
        </span>
      ) : map ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin auth-gated proxy (/api/static-map)
        <img
          src={mapSrc(map)}
          alt="Map"
          loading="lazy"
          className="h-32 w-full rounded-md bg-black/[.06] object-cover dark:bg-white/[.08]"
        />
      ) : null}
      <span className="block min-w-0">
        <span className="block truncate font-medium">{title || fallback}</span>
        {description && (
          <span className="mt-0.5 block line-clamp-2 text-[11px] opacity-70">{description}</span>
        )}
        {price && <span className="mt-0.5 block text-[11px] opacity-70">{price}</span>}
        {facts && <span className="mt-0.5 block text-[11px] opacity-70">{facts}</span>}
        {linkLine}
      </span>
    </span>
  );
}
