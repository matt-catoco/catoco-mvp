import {
  formatCurrency,
  formatDate,
  TRAVEL_MODE_LABELS,
  ACCOMMODATION_SUBTYPE_LABELS,
  EXPERIENCE_SUBTYPE_LABELS,
  type ElementType,
  type TravelMode,
  type AccommodationSubtype,
  type ExperienceSubtype,
} from "@/lib/trip-elements";

export type SnapshotParticipant = { userId: string; displayName: string };

function subtypeLabel(type: ElementType, value: Record<string, unknown>): string | null {
  if (type === "travel") {
    const mode = value.mode as TravelMode | "" | undefined;
    return mode ? (TRAVEL_MODE_LABELS[mode] ?? mode) : null;
  }
  if (type === "accommodation") {
    const subtype = value.subtype as AccommodationSubtype | "" | undefined;
    return subtype ? (ACCOMMODATION_SUBTYPE_LABELS[subtype] ?? subtype) : null;
  }
  if (type === "experience") {
    const subtype = value.experience_subtype as ExperienceSubtype | "" | undefined;
    return subtype ? (EXPERIENCE_SUBTYPE_LABELS[subtype] ?? subtype) : null;
  }
  return null;
}

/**
 * The full picture of what's actually locked in and about to be booked —
 * not the tile-sized summary (OptionSummary) built for a voting grid where
 * space is tight. This is specifically for the funding/booking flow:
 * whoever's about to purchase (or anyone checking what's locked in)
 * shouldn't have to hunt across the page for the booking link, dates,
 * location, or who this element is actually scoped to.
 */
export function BookingSnapshot({
  type,
  value,
  participants,
}: {
  type: ElementType;
  value: Record<string, unknown>;
  participants: SnapshotParticipant[];
}) {
  const str = (k: string) => {
    const v = value[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const title = str("title") || str("name") || "?";
  const description = str("description");
  const thumbnail = str("thumbnail_url");
  const bookingLink = str("booking_link");
  const dates = value.dates as { start_date?: string; end_date?: string } | undefined;
  const departDate = str("depart_date");
  const returnDate = str("return_date");
  const locationName = str("location_name") || str("start_location");
  const destinationLocation = str("destination_location");
  const price = value.price;
  const currency = str("currency") || "USD";
  const priceTier = str("price_tier");
  const cuisine = str("cuisine");
  const guests = value.guests;
  const typeLabel = subtypeLabel(type, value);

  const dateRange = dates?.start_date
    ? `${formatDate(dates.start_date)}${dates.end_date ? ` → ${formatDate(dates.end_date)}` : ""}`
    : departDate
      ? `${formatDate(departDate)}${returnDate ? ` → ${formatDate(returnDate)}` : ""}`
      : null;

  return (
    <div className="overflow-hidden rounded-xl border border-brand-line">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host
        <img src={thumbnail} alt="" className="h-48 w-full object-cover" />
      ) : (
        <div className="flex h-32 w-full items-center justify-center bg-black/[.06] text-[11px] uppercase tracking-wide text-zinc-400 dark:bg-white/[.08]">
          No image
        </div>
      )}
      <div className="flex flex-col gap-3 p-4">
        <div>
          <p className="text-base font-semibold text-black dark:text-zinc-50">{title}</p>
          {description && <p className="mt-1 text-xs text-brand-muted">{description}</p>}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {typeLabel && (
            <div>
              <dt className="text-brand-muted">Type</dt>
              <dd className="font-medium">{typeLabel}</dd>
            </div>
          )}
          {dateRange && (
            <div>
              <dt className="text-brand-muted">Dates</dt>
              <dd className="font-medium">{dateRange}</dd>
            </div>
          )}
          {(locationName || destinationLocation) && (
            <div>
              <dt className="text-brand-muted">{type === "travel" ? "Route" : "Location"}</dt>
              <dd className="font-medium">
                {type === "travel" && locationName && destinationLocation
                  ? `${locationName} → ${destinationLocation}`
                  : locationName || destinationLocation}
              </dd>
            </div>
          )}
          {cuisine && (
            <div>
              <dt className="text-brand-muted">Cuisine</dt>
              <dd className="font-medium">{cuisine}</dd>
            </div>
          )}
          {typeof guests === "number" && (
            <div>
              <dt className="text-brand-muted">Party size</dt>
              <dd className="font-medium">{guests}</dd>
            </div>
          )}
          {price !== undefined && price !== null && String(price).trim() !== "" ? (
            <div>
              <dt className="text-brand-muted">Price</dt>
              <dd className="font-medium">{formatCurrency(Number(price), currency)}</dd>
            </div>
          ) : priceTier ? (
            <div>
              <dt className="text-brand-muted">Price range</dt>
              <dd className="font-medium">{priceTier}</dd>
            </div>
          ) : null}
        </dl>

        {bookingLink && (
          <a
            href={bookingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            Open booking page ↗
          </a>
        )}

        <div className="border-t border-brand-line pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand-muted">
            Who this is for {participants.length > 0 && `(${participants.length})`}
          </p>
          <p className="mt-1 text-xs">
            {participants.length > 0 ? participants.map((p) => p.displayName).join(", ") : "Everyone on the trip"}
          </p>
        </div>
      </div>
    </div>
  );
}
