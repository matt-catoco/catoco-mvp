import {
  ACCOMMODATION_SUBTYPE_LABELS,
  EXPERIENCE_SUBTYPE_LABELS,
  PRICE_BEARING_TYPES,
  TRAVEL_MODE_LABELS,
  formatCurrency,
  formatDate,
  summarizeOptionValue,
  type AccommodationSubtype,
  type ElementType,
  type ExperienceSubtype,
  type TravelMode,
  type TravelersBreakdown,
} from "@/lib/trip-elements";

function priceLine(value: Record<string, unknown>): string | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const currency = typeof value.currency === "string" && value.currency ? value.currency : "USD";
  const amount = Number(raw);
  return Number.isFinite(amount) ? formatCurrency(amount, currency) : `${currency} ${raw}`;
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
function keyFactsLine(type: ElementType, value: Record<string, unknown>): string | null {
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
  const thumbnail = typeof value.thumbnail_url === "string" ? value.thumbnail_url.trim() : "";
  const bookingLink = typeof value.booking_link === "string" ? value.booking_link.trim() : "";
  const price = priceLine(value);
  const fallback = summarizeOptionValue(type, value);
  const facts = PRICE_BEARING_TYPES.includes(type) ? keyFactsLine(type, value) : null;

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
  if ((!PRICE_BEARING_TYPES.includes(type) && type !== "destination") || (!title && !thumbnail)) {
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
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host, next/image would need every domain allowlisted
        <img
          src={thumbnail}
          alt=""
          className="h-32 w-full rounded-md bg-black/[.06] object-cover dark:bg-white/[.08]"
        />
      ) : (
        <span className="flex h-32 w-full items-center justify-center rounded-md bg-black/[.06] text-[10px] uppercase tracking-wide text-zinc-400 dark:bg-white/[.08]">
          No image
        </span>
      )}
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
