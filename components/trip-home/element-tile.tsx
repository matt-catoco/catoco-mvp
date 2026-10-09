import Link from "next/link";
import type { ReactNode } from "react";
import type { ElementTier } from "@/lib/trip-elements";

/**
 * Element card alerts (staging review Part C, 2026-10-09):
 *  - clock: the element's current deadline (submission/voting/funding) is
 *    inside the trip's alert threshold — a property of the ELEMENT, shown
 *    to everyone regardless of what they've done.
 *  - notCommitted: funding is open and THIS viewer hasn't committed.
 *  - footer: the phase deadline + the viewer's own status, and capacity.
 */
export type TileAlerts = {
  clock?: string;
  clockAria?: string;
  notCommitted?: boolean;
  deadlineText?: string;
  myStatus?: { text: string; done: boolean };
  capacity?: string;
};

export type ElementTileProps = {
  symbol: string;
  label: string;
  num: string;
  tier: ElementTier;
  statusLabel: string;
  detail?: string;
  href?: string;
  /**
   * The homepage's element-showcase section is a forced-dark "ink" panel
   * regardless of system light/dark mode (a page-scoped design choice, not
   * the same axis as Tailwind's `dark:` variant) — this swaps in surfaces
   * that read against that fixed-dark backdrop instead of the tokens below,
   * which already flip with system theme and would otherwise pick colors
   * meant for a light page. Trip Home tiles (the default) use the tokens
   * directly.
   */
  onDark?: boolean;
  alerts?: TileAlerts;
};

// Four-tier visual language (2026-09-xx "Trip overview — view options"
// design), shared by every view that renders a tile-shaped element:
// open (dashed, neutral) -> locked (dashed, teal-deep — locked in but not
// yet funded/booked; this is also where Dates/Destination sit once
// "Confirmed", since neither ever gets a funding_request) -> funded (solid
// teal-deep outline) -> ready (solid teal outline, inverted fill — the
// strongest, most "done" state: booked). ready and open swap which surface
// they lean on between the two contexts (a literal fixed ink/paper pair
// for ready, since it's meant to read as unmistakably "done" regardless of
// theme, the same reasoning the old solid-teal "funded" tile used) so both
// stay legible against `onDark`'s always-ink backdrop.
function tileClasses(tier: ElementTier, onDark: boolean): string {
  switch (tier) {
    case "open":
      return onDark
        ? "border-dashed border-white/35 text-white/85"
        : "border-dashed border-brand-line text-foreground";
    case "locked":
      return "border-dashed border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep";
    case "funded":
      // A fixed paper surface, not `bg-background` — that token flips to
      // ink in dark mode, which collides with "ready"'s deliberately fixed
      // ink fill (both tiers would render as an identical dark box, losing
      // the tier distinction dark mode is supposed to preserve).
      return "border-brand-teal-deep bg-[#FAFAF7] text-brand-teal-deep";
    case "ready":
      return onDark
        ? "border-brand-teal bg-brand-teal text-[#0D2020]"
        : "border-brand-teal bg-[#0D2020] text-[#FAFAF7]";
  }
}

/**
 * One Trip Home tile — shared between the real dashboard (app/trips/[tripId])
 * and the homepage's demo showcase (app/page.tsx), per the 2026-08-31 decision
 * to build this once rather than maintain two hand-built copies of the same
 * dashed-vs-solid device (design-handoff/catoco-brand-toolkit.md: dashed
 * outline = open/still deciding, solid fill = locked in by the group) — now
 * a 4-way progression (2026-09-xx, matches the Table view's legend): open ->
 * locked -> funded -> ready.
 */
export function ElementTile({
  symbol,
  label,
  num,
  tier,
  statusLabel,
  detail,
  href,
  onDark = false,
  alerts,
}: ElementTileProps) {
  const tileClassNames = [
    "relative flex min-h-[128px] flex-col justify-between overflow-hidden rounded-2xl border-2 p-5 text-left transition-colors",
    tileClasses(tier, onDark),
    href ? "hover:border-brand-teal-deep cursor-pointer" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner: ReactNode = (
    <>
      <span className="text-[11px] font-semibold opacity-55">{num}</span>
      <span className="my-1.5 font-[family-name:var(--font-display)] text-2xl font-bold">
        {symbol}
      </span>
      <span className="text-xs font-semibold">{label}</span>
      <span className="mt-2.5 line-clamp-2 text-[10.5px] opacity-70">
        {statusLabel}
        {detail ? ` — ${detail}` : ""}
      </span>
      {alerts && (alerts.deadlineText || alerts.myStatus || alerts.capacity) && (
        <span className="mt-2 flex flex-col gap-0.5 border-t border-current/15 pt-2 text-[10.5px]">
          {(alerts.deadlineText || alerts.myStatus) && (
            <span className="flex flex-wrap justify-between gap-x-2">
              {alerts.deadlineText && <span className="opacity-70">{alerts.deadlineText}</span>}
              {alerts.myStatus && (
                <span className={alerts.myStatus.done ? "font-semibold" : "font-semibold text-amber-700 dark:text-amber-400"}>
                  {alerts.myStatus.done ? "✓ " : ""}
                  {alerts.myStatus.text}
                </span>
              )}
            </span>
          )}
          {alerts.capacity && <span className="opacity-70">{alerts.capacity}</span>}
        </span>
      )}
      {alerts && (alerts.clock || alerts.notCommitted) && (
        <span className="absolute right-3 top-3 flex items-center gap-1.5">
          {alerts.clock && (
            <span
              role="img"
              aria-label={alerts.clockAria ?? `Deadline in ${alerts.clock}`}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {alerts.clock}
            </span>
          )}
          {alerts.notCommitted && (
            <svg role="img" aria-label="You haven't committed yet" width="22" height="22" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="12" fill="#D4402F" />
              <path d="M12 6.4v7.2" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
              <circle cx="12" cy="17.6" r="1.6" fill="#fff" />
            </svg>
          )}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={tileClassNames}>
        {inner}
      </Link>
    );
  }

  return <div className={tileClassNames}>{inner}</div>;
}
