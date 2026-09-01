import { PRICE_BEARING_TYPES, summarizeOptionValue, type ElementType } from "@/lib/trip-elements";

function priceLine(value: Record<string, unknown>): string | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const currency = typeof value.currency === "string" && value.currency ? value.currency : "USD";
  return `${currency} ${raw}`;
}

/**
 * Renders a candidate for comparison — thumbnail + title + description +
 * price when the booking link's Open Graph tags came back with anything
 * (lib/link-preview.ts, best-effort), falling back to the plain text
 * summary otherwise. Used everywhere a submitted option is shown to more
 * than its own proposer: the voting list and the settled/locked value.
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
  const price = priceLine(value);
  const fallback = summarizeOptionValue(type, value);

  if (!PRICE_BEARING_TYPES.includes(type) || (!title && !thumbnail)) {
    return <>{fallback}</>;
  }

  return (
    <span className="flex min-w-0 items-center gap-3">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host, next/image would need every domain allowlisted
        <img
          src={thumbnail}
          alt=""
          className="h-12 w-12 shrink-0 rounded-md bg-black/[.06] object-cover dark:bg-white/[.08]"
        />
      ) : (
        <span className="h-12 w-12 shrink-0 rounded-md bg-black/[.06] dark:bg-white/[.08]" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title || fallback}</span>
        {description && (
          <span className="block truncate text-[11px] opacity-70">{description}</span>
        )}
        {price && <span className="block text-[11px] opacity-70">{price}</span>}
      </span>
    </span>
  );
}
