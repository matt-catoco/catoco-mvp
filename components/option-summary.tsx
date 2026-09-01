import { PRICE_BEARING_TYPES, summarizeOptionValue, type ElementType } from "@/lib/trip-elements";

function priceLine(value: Record<string, unknown>): string | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const currency = typeof value.currency === "string" && value.currency ? value.currency : "USD";
  return `${currency} ${raw}`;
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
  const price = priceLine(value);
  const fallback = summarizeOptionValue(type, value);

  if (!PRICE_BEARING_TYPES.includes(type) || (!title && !thumbnail)) {
    return <span className="block">{fallback}</span>;
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
      </span>
    </span>
  );
}
