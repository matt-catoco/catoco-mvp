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
 * One My Trips card: a photo header (real icon/Unsplash photo, with the
 * destination overlaid and attribution when the photo is Unsplash-sourced)
 * or, when there's neither a custom icon nor a known destination, a
 * teal-wash placeholder. No status badge, progress indicator, or
 * participant count anywhere on this card — see the build prompt's own
 * "Explicitly deferred" section for why.
 */
export function TripCard({ trip }: { trip: TripCardData }) {
  const resolved = resolveIcon(trip.icon);
  const hasPhoto = resolved !== null;
  const hasDestination = trip.destinations.length > 0;
  const showAttribution = hasPhoto && resolved.source === "unsplash" && trip.iconAttribution;

  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-brand-line transition-colors hover:border-brand-teal-deep"
    >
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-brand-teal-wash">
        {hasPhoto ? (
          <>
            <Image
              src={resolved.url}
              alt=""
              fill
              unoptimized
              className="object-cover"
            />
            {(hasDestination || showAttribution) && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-3.5 pb-2.5 pt-10">
                {hasDestination && (
                  <p className="text-sm font-semibold leading-tight text-white">
                    <DestinationLabel destinations={trip.destinations} />
                  </p>
                )}
                {showAttribution && (
                  <p className="mt-0.5 text-[10px] text-white/70">
                    Photo by {trip.iconAttribution!.photographerName} on{" "}
                    <a
                      href={`${trip.iconAttribution!.photographerProfileUrl}?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Unsplash
                    </a>
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center">
            <p className="text-sm font-semibold leading-tight text-brand-teal-deep">
              {hasDestination ? <DestinationLabel destinations={trip.destinations} /> : "Destination — still deciding"}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-3.5 py-3">
        <span className="truncate text-sm font-semibold text-black dark:text-zinc-50">{trip.name}</span>
        <span className={`text-xs text-brand-muted ${trip.datesLabel ? "" : "italic"}`}>
          {trip.datesLabel ?? "Dates not set yet"}
        </span>
      </div>
    </Link>
  );
}
