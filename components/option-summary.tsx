import { formatCurrency, PRICE_BEARING_TYPES, summarizeOptionValue, type ElementType } from "@/lib/trip-elements";

function priceLine(value: Record<string, unknown>): string | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const currency = typeof value.currency === "string" && value.currency ? value.currency : "USD";
  const amount = Number(raw);
  return Number.isFinite(amount) ? formatCurrency(amount, currency) : `${currency} ${raw}`;
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

  // §10: Destination/Experience/Dining tiles are meant to auto-photo from
  // Unsplash — not wired yet (no API key exists), so there's nothing to show
  // a "no image" box for on Destination specifically (it has no booking_link
  // to scrape an Open Graph thumbnail from the way the price-bearing types
  // do). When Unsplash ships, this is the branch to extend: give Destination
  // a resolved photo the same way thumbnail/title come from link-preview.ts
  // for the others today.
  if (!PRICE_BEARING_TYPES.includes(type) || (!title && !thumbnail)) {
    return (
      <span className="block">
        {fallback}
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
        {linkLine}
      </span>
    </span>
  );
}
