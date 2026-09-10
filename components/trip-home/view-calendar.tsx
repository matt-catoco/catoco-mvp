import Link from "next/link";
import type { ElementTier } from "@/lib/trip-elements";
import { formatDayHeader, formatTimeOfDay, isoDateRange, type ScheduleOccurrence } from "@/lib/element-schedule";
import type { OverviewElement } from "./types";

// Beyond this, a day-per-column grid stops being useful (mostly horizontal
// scrolling, barely any of it visible at once) — Itinerary's agenda list
// handles a long trip far better, so Calendar bows out with a pointer to it
// rather than rendering an unusable wall of columns.
const MAX_CALENDAR_DAYS = 31;

const TILE_CLASSES: Record<ElementTier, string> = {
  open: "border-dashed border-brand-line text-brand-muted",
  locked: "border-dashed border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep",
  // Fixed paper, not `bg-background` — see element-tile.tsx's note: that
  // token flips to ink in dark mode and collides with `ready`'s own fixed
  // ink fill just below.
  funded: "border-brand-teal-deep bg-[#FAFAF7] text-brand-teal-deep",
  ready: "border-brand-teal bg-[#0D2020] text-[#FAFAF7]",
};

const SPAN_CLASSES: Record<ElementTier, string> = {
  open: "bg-black/[.06] text-brand-muted dark:bg-white/[.08]",
  locked: "bg-brand-teal-wash text-brand-teal-deep",
  funded: "bg-brand-teal-wash text-brand-teal-deep",
  ready: "bg-[#0D2020] text-[#FAFAF7]",
};

type Entry = { el: OverviewElement; occ: ScheduleOccurrence };

/**
 * Day-header columns left to right; anything multi-day (Destination,
 * Accommodation spans) banners full-width above the grid instead of trying
 * to fill every cell it touches; whatever's actually scheduled stacks
 * vertically in its day's column, in time order. Deliberately not an
 * hour-by-hour grid — nothing in this schema has real time-of-day except
 * Dining, so an hourly axis would be mostly empty rows.
 */
export function ViewCalendar({
  elements,
  tripDates,
  destinationName,
}: {
  elements: OverviewElement[];
  tripDates: { start: string; end: string } | null;
  destinationName: string | null;
}) {
  const schedulable = elements.filter((el) => el.type !== "dates" && el.type !== "destination");
  const unscheduled = schedulable.filter((el) => !el.schedule);

  if (!tripDates) {
    return (
      <p className="rounded-lg border border-brand-line p-6 text-center text-sm text-brand-muted">
        This trip doesn&apos;t have specific Dates locked in yet — Calendar needs a start and end date.
        Try Itinerary or Table instead.
      </p>
    );
  }

  const days = isoDateRange(tripDates.start, tripDates.end);
  if (days.length > MAX_CALENDAR_DAYS) {
    return (
      <p className="rounded-lg border border-brand-line p-6 text-center text-sm text-brand-muted">
        This trip spans {days.length} days — too many to lay out as a calendar grid. Try Itinerary
        instead.
      </p>
    );
  }

  const spans = schedulable.filter((el) => el.schedule?.span);

  const byDate = new Map<string, Entry[]>();
  for (const el of schedulable) {
    if (!el.schedule) continue;
    for (const occ of el.schedule.occurrences) {
      const list = byDate.get(occ.date) ?? [];
      list.push({ el, occ });
      byDate.set(occ.date, list);
    }
  }
  for (const entries of byDate.values()) {
    entries.sort((a, b) => (a.occ.time ?? "99:99").localeCompare(b.occ.time ?? "99:99"));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto pb-2">
        <div
          className="grid items-start gap-2.5"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(108px, 1fr))` }}
        >
          {days.map((date) => {
            const { weekday, dateLabel } = formatDayHeader(date);
            return (
              <div
                key={date}
                className="border-b-[1.5px] border-brand-line pb-2 text-center font-[family-name:var(--font-display)] text-[13px] font-bold text-foreground"
              >
                {dateLabel}
                <span className="mt-0.5 block font-[family-name:var(--font-body)] text-[10.5px] font-semibold text-brand-muted">
                  {weekday}
                </span>
              </div>
            );
          })}

          {destinationName && (
            <div
              className="col-span-full rounded-lg bg-brand-teal-wash px-4 py-2.5 text-[13px] font-bold text-brand-teal-deep"
              style={{ gridColumn: `1 / -1` }}
            >
              📍 {destinationName} — destination locked
            </div>
          )}
          {spans.map((el) => (
            <div
              key={el.id}
              className={`rounded-lg px-4 py-2.5 text-[13px] font-bold ${SPAN_CLASSES[el.tier]}`}
              style={{ gridColumn: `1 / -1` }}
            >
              🏠 {el.label} — {el.statusLabel}, {formatDayHeader(el.schedule!.span!.start).dateLabel}–
              {formatDayHeader(el.schedule!.span!.end).dateLabel}
            </div>
          ))}

          {days.map((date) => (
            <div key={date} className="flex flex-col gap-2">
              {(byDate.get(date) ?? []).map((entry) => (
                <Link
                  key={`${entry.el.id}-${entry.occ.label}`}
                  href={entry.el.href}
                  className={`rounded-xl border-2 p-2.5 transition-opacity hover:opacity-90 ${TILE_CLASSES[entry.el.tier]}`}
                >
                  <span className="block font-[family-name:var(--font-body)] text-[10px] font-bold opacity-80">
                    {entry.occ.time ? formatTimeOfDay(entry.occ.time) : entry.el.schedule?.isProposed ? "proposed" : entry.occ.label || " "}
                  </span>
                  <span className="mt-1 block font-[family-name:var(--font-display)] text-[15px] font-bold">
                    {entry.el.symbol}
                  </span>
                  <span className="mt-0.5 block truncate font-[family-name:var(--font-body)] text-[10.5px] font-semibold leading-tight">
                    {entry.el.label}
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="border-t border-brand-line pt-5">
          <div className="mb-2.5 text-xs font-bold text-brand-muted">Not yet scheduled</div>
          <div className="flex flex-col gap-2">
            {unscheduled.map((el) => (
              <Link
                key={el.id}
                href={el.href}
                className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 transition-opacity hover:opacity-90 ${TILE_CLASSES[el.tier]}`}
              >
                <span className="font-[family-name:var(--font-display)] text-sm font-bold">{el.symbol}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">{el.label}</span>
                  <span className="block text-[11.5px] opacity-75">{el.statusLabel}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
