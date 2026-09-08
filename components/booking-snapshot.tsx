import {
  formatCurrency,
  formatDate,
  TRAVEL_MODE_LABELS,
  ACCOMMODATION_SUBTYPE_LABELS,
  ACCOMMODATION_FIELD_LABELS,
  EXPERIENCE_SUBTYPE_LABELS,
  type ElementType,
  type TravelMode,
  type AccommodationSubtype,
  type AccommodationFieldKey,
  type ExperienceSubtype,
} from "@/lib/trip-elements";

export type SnapshotParticipant = { userId: string; displayName: string };

/**
 * Drives the two contexts this same snapshot appears in (the funding-flow
 * audit's own distinction): while collecting contributions, everyone cares
 * about their own per-person share, not the trip-wide total, and doesn't
 * need a full roster — a count is enough. Once it's actually being booked,
 * the organizer needs the real total (or what was actually paid) and the
 * real names, since they're the one reconciling who owes what / confirming
 * with the group. No `pricing` prop at all (payment_type=none elements —
 * Dates/Destination, or an unpriced locked option) falls back to booking-
 * style rendering (total/names) since there's no per-person math to show.
 */
export type SnapshotPricing = {
  mode: "funding" | "booking";
  totalRequired?: number;
  perPersonShare?: number;
  actualPaid?: number;
  currency: string;
};

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

/** Subtype-specific structured fields — room type, vehicle type, breakfast
 * included, etc. — the level of detail below the headline Type/Subtype. */
function subDetails(type: ElementType, value: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (type === "accommodation") {
    const fields = (value.accommodation_fields ?? {}) as Partial<Record<AccommodationFieldKey, string>>;
    for (const [key, val] of Object.entries(fields)) {
      if (!val) continue;
      out.push({ label: ACCOMMODATION_FIELD_LABELS[key as AccommodationFieldKey] ?? key, value: val });
    }
  }
  if (type === "travel" && value.mode === "rental_car") {
    if (typeof value.vehicle_type === "string" && value.vehicle_type) {
      out.push({ label: "Vehicle type", value: value.vehicle_type });
    }
    if (typeof value.transmission === "string" && value.transmission) {
      out.push({ label: "Transmission", value: value.transmission === "automatic" ? "Automatic" : "Manual" });
    }
  }
  return out;
}

export function BookingSnapshot({
  type,
  value,
  participants,
  pricing,
}: {
  type: ElementType;
  value: Record<string, unknown>;
  participants: SnapshotParticipant[];
  pricing?: SnapshotPricing;
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
  const diningTime = str("dining_time");
  const locationName = str("location_name") || str("start_location");
  const destinationLocation = str("destination_location");
  const pickupLocation = str("pickup_location");
  const price = value.price;
  const currency = str("currency") || pricing?.currency || "USD";
  const priceTier = str("price_tier");
  const cuisine = str("cuisine");
  const guests = value.guests;
  const typeLabel = subtypeLabel(type, value);
  const details = subDetails(type, value);

  const dateRange = dates?.start_date
    ? `${formatDate(dates.start_date)}${dates.end_date ? ` → ${formatDate(dates.end_date)}` : ""}`
    : departDate
      ? `${formatDate(departDate)}${returnDate ? ` → ${formatDate(returnDate)}` : ""}`
      : null;

  const isFunding = pricing?.mode === "funding";

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
          {details.map((d) => (
            <div key={d.label}>
              <dt className="text-brand-muted">{d.label}</dt>
              <dd className="font-medium">{d.value}</dd>
            </div>
          ))}
          {dateRange && (
            <div>
              <dt className="text-brand-muted">Dates</dt>
              <dd className="font-medium">{dateRange}</dd>
            </div>
          )}
          {diningTime && (
            <div>
              <dt className="text-brand-muted">Time</dt>
              <dd className="font-medium">{diningTime}</dd>
            </div>
          )}
          {(locationName || destinationLocation || pickupLocation) && (
            <div>
              <dt className="text-brand-muted">{type === "travel" ? "Route" : "Location"}</dt>
              <dd className="font-medium">
                {type === "travel" && locationName && destinationLocation
                  ? `${locationName} → ${destinationLocation}`
                  : locationName || destinationLocation || pickupLocation}
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

          {/* Price: funding context shows the per-person share (what the
              viewer actually owes); booking context shows the real total,
              or what was actually paid once booked. Falls back to the raw
              listed price/tier when there's no funding_request at all. */}
          {isFunding && pricing?.perPersonShare !== undefined ? (
            <div>
              <dt className="text-brand-muted">Your share</dt>
              <dd className="font-medium">{formatCurrency(pricing.perPersonShare, currency)}/person</dd>
            </div>
          ) : pricing && !isFunding ? (
            <div>
              <dt className="text-brand-muted">{pricing.actualPaid !== undefined ? "Actual paid" : "Total"}</dt>
              <dd className="font-medium">
                {formatCurrency(pricing.actualPaid ?? pricing.totalRequired ?? 0, currency)}
              </dd>
            </div>
          ) : price !== undefined && price !== null && String(price).trim() !== "" ? (
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
          {isFunding ? (
            <p className="mt-1 text-xs">
              {participants.length > 0 ? `Split ${participants.length} ways` : "Everyone on the trip"}
            </p>
          ) : (
            <p className="mt-1 text-xs">
              {participants.length > 0 ? participants.map((p) => p.displayName).join(", ") : "Everyone on the trip"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
