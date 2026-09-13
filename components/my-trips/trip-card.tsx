import Image from "next/image";
import Link from "next/link";
import { resolveIcon, UNSPLASH_UTM_SOURCE, type IconAttribution } from "@/lib/trip-icons";

export type TripCardData = {
  id: string;
  name: string;
  icon: string | null;
  iconAttribution: IconAttribution | null;
  /** Full names, creation order — "Lisbon, Portugal + Barcelona, Spain," never shorthand. */
  destinations: string[];
  /** Already formatted for display, or null when nothing's locked yet. */
  datesLabel: string | null;
};

/** Each destination gets its own no-wrap span so a break only ever lands
 * between destinations (at the " + "), never inside one — confirmed in the
 * mockup at mobile width. */
function DestinationLabel({ destinations }: { destinations: string[] }) {
  return (
    <>
      {destinations.map((d, i) => (
        <span key={i}>
          {i > 0 && " + "}
          <span className="dest-unit whitespace-nowrap">{d}</span>
        </span>
      ))}
    </>
  );
}

/**
 * The brand mark, watermarked into the photo header's corner — exact
 * markup from the mockup, not a re-derivation of components/logo-mark.tsx
 * (that one's opaque and always teal-filled; this is deliberately two
 * separate colorings depending on what it sits on top of). "filled" is
 * paper-on-ink — legible low-opacity texture over the teal gradient
 * placeholder. "outline" drops the fill square entirely — against the flat
 * teal-wash empty state a solid paper square would just look like a stray
 * box, not a watermark.
 */
function WatermarkMark({ variant }: { variant: "filled" | "outline" }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      className="pointer-events-none absolute -right-[30px] -top-[30px] h-[180px] w-[180px]"
      style={{ opacity: variant === "filled" ? 0.16 : 0.5 }}
    >
      {variant === "filled" ? (
        <>
          <rect width="100" height="100" rx="22" fill="#FAFAF7" />
          <rect x="15" y="15" width="70" height="70" rx="12" fill="none" stroke="#0D2020" strokeWidth="3" strokeDasharray="3,4" />
          <rect x="36" y="36" width="28" height="28" rx="6" fill="#0D2020" transform="rotate(45 50 50)" />
        </>
      ) : (
        <>
          <rect width="100" height="100" rx="22" fill="none" stroke="#0F8C7E" strokeWidth="3" strokeDasharray="3,4" />
          <rect x="36" y="36" width="28" height="28" rx="6" fill="#0F8C7E" transform="rotate(45 50 50)" />
        </>
      )}
    </svg>
  );
}

function AttributionMark({ attribution }: { attribution: IconAttribution }) {
  return (
    <p
      className="absolute bottom-1.5 right-1.5 z-[1] rounded bg-black/35 px-1.5 py-0.5 text-[9px] leading-none text-white/80 backdrop-blur-[2px]"
      onClick={(e) => e.stopPropagation()}
    >
      Photo:{" "}
      <a
        href={`${attribution.photographerProfileUrl}?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        {attribution.photographerName}
      </a>
    </p>
  );
}

/**
 * One My Trips card. Three photo-header states, matching the mockup:
 *   - a real photo (trip icon or Unsplash) when one's set — the watermark
 *     is a placeholder-only device, never layered over an actual photo;
 *   - a teal gradient + watermark + destination label, when there's a
 *     known destination but no photo yet — production's stand-in for "no
 *     photo, but not nothing either";
 *   - flat teal-wash + a more visible watermark + "still deciding", when
 *     neither is known.
 * No status badge, progress indicator, or participant count anywhere on
 * this card — see the build prompt's own "Explicitly deferred" section.
 */
export function TripCard({ trip }: { trip: TripCardData }) {
  const resolved = resolveIcon(trip.icon);
  const hasPhoto = resolved !== null;
  const hasDestination = trip.destinations.length > 0;
  const attribution = hasPhoto && resolved.source === "unsplash" ? trip.iconAttribution : null;

  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group flex flex-col overflow-hidden rounded-[20px] border-[1.5px] border-brand-line bg-background transition-colors hover:border-brand-teal-deep"
    >
      <div className="relative flex h-[180px] w-full shrink-0 items-end overflow-hidden">
        {hasPhoto ? (
          <>
            <Image src={resolved.url} alt="" fill unoptimized className="object-cover" />
            {hasDestination && (
              <p
                className="relative z-[1] px-[18px] py-4 font-[family-name:var(--font-display)] text-base font-bold text-[#FAFAF7] [text-shadow:0_1px_8px_rgba(0,0,0,.25)]"
              >
                <DestinationLabel destinations={trip.destinations} />
              </p>
            )}
            {attribution && <AttributionMark attribution={attribution} />}
          </>
        ) : hasDestination ? (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-teal to-brand-teal-deep">
            <WatermarkMark variant="filled" />
            <p className="relative z-[1] px-[18px] py-4 font-[family-name:var(--font-display)] text-base font-bold text-[#FAFAF7] [text-shadow:0_1px_8px_rgba(0,0,0,.25)]">
              <DestinationLabel destinations={trip.destinations} />
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-end bg-brand-teal-wash">
            <WatermarkMark variant="outline" />
            <p className="relative z-[1] px-[18px] py-4 font-[family-name:var(--font-display)] text-base font-bold text-brand-teal-deep">
              Destination — still deciding
            </p>
          </div>
        )}
      </div>
      <div className="px-5 pb-[22px] pt-[18px]">
        <div className="mb-1 truncate font-[family-name:var(--font-display)] text-[19px] font-bold text-black dark:text-zinc-50">
          {trip.name}
        </div>
        <div className={`text-[13.5px] text-brand-muted ${trip.datesLabel ? "" : "italic"}`}>
          {trip.datesLabel ?? "Dates not set yet"}
        </div>
      </div>
    </Link>
  );
}
