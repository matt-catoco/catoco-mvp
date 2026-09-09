import Link from "next/link";
import type { ElementTier } from "@/lib/trip-elements";
import { formatDayHeader, formatTimeOfDay, isoDateRange, type ScheduleOccurrence } from "@/lib/element-schedule";
import type { OverviewElement } from "./types";

const CARD_CLASSES: Record<ElementTier, string> = {
  open: "border-dashed border-brand-line",
  locked: "border-dashed border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep",
  funded: "border-brand-teal-deep bg-background text-brand-teal-deep",
  ready: "border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep",
};

const SYMBOL_CLASSES: Record<ElementTier, string> = {
  open: "bg-black/[.06] text-brand-muted dark:bg-white/[.08]",
  locked: "bg-brand-teal-deep/15 text-brand-teal-deep",
  funded: "bg-brand-teal-deep/15 text-brand-teal-deep",
  ready: "bg-brand-teal-deep/15 text-brand-teal-deep",
};

type Entry = { el: OverviewElement; occ: ScheduleOccurrence };
type DayBlock = { date: string; entries: Entry[] } | { rangeDates: string[] };

function formatRangeHeader(dates: string[]): string {
  const first = formatDayHeader(dates[0]);
  if (dates.length === 1) return `${first.weekday}, ${first.dateLabel}`;
  const last = formatDayHeader(dates[dates.length - 1]);
  const firstDay = dates[0].slice(8, 10).replace(/^0/, "");
  const lastDay = dates[dates.length - 1].slice(8, 10).replace(/^0/, "");
  const firstMonth = first.dateLabel.split(" ")[0];
  const lastMonth = last.dateLabel.split(" ")[0];
  return firstMonth === lastMonth
    ? `${first.weekday} – ${last.weekday}, ${firstMonth} ${firstDay}–${lastDay}`
    : `${first.weekday} ${first.dateLabel} – ${last.weekday} ${last.dateLabel}`;
}

function EntryCard({ el, occ }: Entry) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[110px] shrink-0 text-xs font-bold text-brand-muted">
        {occ.time ? (
          formatTimeOfDay(occ.time)
        ) : el.schedule?.isProposed ? (
          <span className="font-semibold opacity-80">proposed</span>
        ) : (
          occ.label || "—"
        )}
      </div>
      <Link
        href={el.href}
        className={`flex flex-1 items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 transition-opacity hover:opacity-90 ${CARD_CLASSES[el.tier]}`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-[family-name:var(--font-display)] text-[13px] font-bold ${SYMBOL_CLASSES[el.tier]}`}
        >
          {el.symbol}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-bold">
            {el.label}
            {occ.label && occ.time === null && occ.label !== el.label ? ` — ${occ.label}` : ""}
          </span>
          <span className="block text-[11.5px] opacity-75">
            {el.statusLabel}
            {el.schedule?.isProposed ? " · proposed" : ""}
          </span>
        </span>
      </Link>
    </div>
  );
}

/**
 * Every scheduled element in one agenda, grouped by day, ordered by time
 * within the day. Dates/Destination are excluded entirely (never
 * schedulable rows — Destination surfaces as a context chip up top instead,
 * Dates just defines the day range this view is built from).
 */
export function ViewItinerary({
  elements,
  tripDates,
  destinationName,
}: {
  elements: OverviewElement[];
  tripDates: { start: string; end: string } | null;
  destinationName: string | null;
}) {
  const schedulable = elements.filter((el) => el.type !== "dates" && el.type !== "destination");
  const spans = schedulable.filter((el) => el.schedule?.span);
  const unscheduled = schedulable.filter((el) => !el.schedule);

  // Every dated occurrence, flattened, grouped by date.
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

  const days = tripDates ? isoDateRange(tripDates.start, tripDates.end) : [...byDate.keys()].sort();

  const blocks: DayBlock[] = [];
  let emptyRun: string[] = [];
  for (const date of days) {
    const entries = byDate.get(date) ?? [];
    if (entries.length === 0 && tripDates) {
      emptyRun.push(date);
      continue;
    }
    if (emptyRun.length) {
      blocks.push({ rangeDates: emptyRun });
      emptyRun = [];
    }
    blocks.push({ date, entries });
  }
  if (emptyRun.length) blocks.push({ rangeDates: emptyRun });

  if (blocks.length === 0 && unscheduled.length === 0) {
    return (
      <p className="rounded-lg border border-brand-line p-6 text-center text-sm text-brand-muted">
        Nothing scheduled yet — add dates to your elements to see them here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {(destinationName || spans.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {destinationName && (
            <span className="rounded-full bg-brand-teal-wash px-3.5 py-1.5 text-xs font-semibold text-brand-teal-deep">
              📍 {destinationName}
            </span>
          )}
          {spans.map((el) => (
            <span
              key={el.id}
              className="rounded-full bg-brand-teal-wash px-3.5 py-1.5 text-xs font-semibold text-brand-teal-deep"
            >
              {el.symbol === "Ac" ? "🏠" : ""} {el.label} · {formatDayHeader(el.schedule!.span!.start).dateLabel}–
              {formatDayHeader(el.schedule!.span!.end).dateLabel}
            </span>
          ))}
        </div>
      )}

      {!tripDates && (
        <p className="text-xs text-brand-muted">
          Showing days with something scheduled — lock in this trip&apos;s Dates to see the full day-by-day range.
        </p>
      )}

      <div className="flex flex-col gap-5">
        {blocks.map((block, i) =>
          "date" in block ? (
            <div key={block.date}>
              <div className="mb-2.5 border-b-[1.5px] border-brand-line pb-1.5 font-[family-name:var(--font-display)] text-sm font-bold text-foreground">
                {formatRangeHeader([block.date])}
              </div>
              {block.entries.length === 0 ? (
                <p className="text-xs italic text-brand-muted">Nothing scheduled yet</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {block.entries.map((entry) => (
                    <EntryCard key={`${entry.el.id}-${entry.occ.date}-${entry.occ.label}`} {...entry} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div key={`empty-${i}`}>
              <div className="mb-2.5 border-b-[1.5px] border-brand-line pb-1.5 font-[family-name:var(--font-display)] text-sm font-bold text-brand-muted">
                {formatRangeHeader(block.rangeDates)}
              </div>
              <p className="text-xs italic text-brand-muted">Nothing scheduled yet</p>
            </div>
          ),
        )}
      </div>

      {unscheduled.length > 0 && (
        <div className="mt-2 border-t border-brand-line pt-5">
          <div className="mb-2.5 text-xs font-bold text-brand-muted">Not yet scheduled</div>
          <div className="flex flex-col gap-2">
            {unscheduled.map((el) => (
              <Link
                key={el.id}
                href={el.href}
                className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 transition-opacity hover:opacity-90 ${CARD_CLASSES[el.tier]}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-[family-name:var(--font-display)] text-[13px] font-bold ${SYMBOL_CLASSES[el.tier]}`}
                >
                  {el.symbol}
                </span>
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
