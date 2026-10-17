"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ElementTier } from "@/lib/trip-elements";
import { isoDateRange, type ScheduleOccurrence } from "@/lib/element-schedule";
import { StatusLegend } from "./status-legend";
import type { OverviewElement } from "./types";

// Day grid: hour rows 07:00–23:00, 36px an hour.
const HOUR_START = 7;
const HOUR_END = 23;
const HOUR_PX = 36;
const MIN_EVENT_PX = 34;
// Nothing but a flight's arrival carries an end time; everything else gets
// a plausible default length so it has a readable block.
const DEFAULT_MINUTES: Partial<Record<OverviewElement["type"], number>> = {
  dining: 120,
  experience: 180,
  travel: 120,
};

/** The four tile status styles (element-tile.tsx), dark-mode safe. */
const TIER_CLASSES: Record<ElementTier, string> = {
  open: "border-dashed border-brand-line bg-background text-foreground",
  locked: "border-dashed border-brand-accent bg-brand-teal-wash text-brand-accent",
  // Fixed paper, not `bg-background` — that token flips to ink in dark
  // mode and would collide with `ready`'s fixed ink fill.
  funded: "border-solid border-brand-teal-deep bg-[#FAFAF7] text-brand-teal-deep",
  ready: "border-solid border-brand-teal bg-[#0D2020] text-[#FAFAF7]",
};

const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

type Entry = { el: OverviewElement; occ: ScheduleOccurrence };

// ---- dates (bare YYYY-MM-DD, read in UTC so nothing shifts a day) --------
function utc(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => utc(iso).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const monthKey = (iso: string) => iso.slice(0, 7);
function monthTitle(first: string, last: string): string {
  if (monthKey(first) === monthKey(last)) return fmt(first, { month: "long", year: "numeric" });
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${fmt(first, { month: "long" })} – ${fmt(last, { month: "long", year: "numeric" })}`;
  }
  return `${fmt(first, { month: "long", year: "numeric" })} – ${fmt(last, { month: "long", year: "numeric" })}`;
}
/** "12 to 14 Jun 2027", "30 Jun to 2 Jul 2027", "14 Jun 2027". */
function rangeLabel(first: string, last: string): string {
  if (first === last) return fmt(first, { day: "numeric", month: "short", year: "numeric" });
  if (monthKey(first) === monthKey(last)) {
    return `${fmt(first, { day: "numeric" })} to ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return `${fmt(first, { day: "numeric", month: "short" })} to ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
}
function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
/** Monday-first month grid: leading blanks, then every date of the month. */
function monthCells(key: string): (string | null)[] {
  const [y, m] = key.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= count; d++) cells.push(`${key}-${String(d).padStart(2, "0")}`);
  return cells;
}

// ---- times ----------------------------------------------------------------
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
function timeText(occ: ScheduleOccurrence): string | null {
  if (!occ.time) return null;
  return occ.endTime && toMinutes(occ.endTime) > toMinutes(occ.time) ? `${occ.time} to ${occ.endTime}` : occ.time;
}

/**
 * Trip Home Calendar (founder, 2026-10-17; mockup "Trip Home Views"): one
 * tab holding the day view (a time grid, 3 days by default, any custom
 * length) and the Itinerary (a list by day for the whole trip — the old
 * Itinerary tab). Stays span the all-day row; timed events sit in hour rows;
 * everything uses the tile status styles.
 */
export function ViewCalendar({
  elements,
  tripDates,
}: {
  elements: OverviewElement[];
  tripDates: { start: string; end: string } | null;
}) {
  if (!tripDates) {
    return (
      <p className="rounded-lg border border-brand-line p-6 text-center text-sm text-brand-muted">
        This trip doesn&apos;t have its Dates locked in yet. The calendar needs a start and end date, so try Table for now.
      </p>
    );
  }
  return <Calendar elements={elements} days={isoDateRange(tripDates.start, tripDates.end)} />;
}

function Calendar({ elements, days }: { elements: OverviewElement[]; days: string[] }) {
  const len = days.length;
  const [mode, setMode] = useState<"days" | "itinerary">("days");
  const [n, setN] = useState(Math.min(3, len));
  const [start, setStart] = useState(0);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [month, setMonth] = useState(monthKey(days[0]));
  const ddRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const clampStart = (s: number, length: number) => Math.max(0, Math.min(s, len - length));
  const shown = days.slice(start, start + n);
  const first = shown[0];
  const last = shown[shown.length - 1];

  function close(focus = true) {
    setOpen(false);
    setAnchor(null);
    setHover(null);
    if (focus) requestAnimationFrame(() => btnRef.current?.focus());
  }
  function openPicker() {
    setMode("days");
    setMonth(monthKey(first));
    setAnchor(null);
    setOpen(true);
  }

  // Click away / Escape closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Opening moves focus to the first day in view.
  useEffect(() => {
    if (open && anchor === null) {
      popRef.current?.querySelector<HTMLButtonElement>("button[data-in='true'], button[data-trip='true']")?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pickDay(idx: number) {
    if (anchor === null) {
      // First click: move the view there, keeping the length, and wait for an end day.
      setStart(clampStart(idx, n));
      setAnchor(idx);
      return;
    }
    if (idx === anchor) {
      close();
      return;
    }
    const lo = Math.min(anchor, idx);
    const hi = Math.max(anchor, idx);
    setStart(lo);
    setN(hi - lo + 1);
    close();
  }

  function shortcut(k: number) {
    const length = Math.min(k, len);
    setN(length);
    setStart((s) => clampStart(s, length));
    close();
  }

  // ---- entries ------------------------------------------------------------
  const schedulable = elements.filter((el) => el.type !== "dates" && el.type !== "destination");
  const unscheduled = schedulable.filter((el) => !el.schedule);
  const spans = schedulable.filter((el) => el.schedule?.span);
  const byDate = new Map<string, Entry[]>();
  for (const el of schedulable) {
    for (const occ of el.schedule?.occurrences ?? []) {
      byDate.set(occ.date, [...(byDate.get(occ.date) ?? []), { el, occ }]);
    }
  }

  const months = [...new Set(days.map(monthKey))];
  const lengthLabel = `${n} day${n === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        {mode === "days" ? (
          <>
            <div ref={ddRef} className="relative">
              <button
                ref={btnRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`Choose dates, showing ${rangeLabel(first, last)}`}
                onClick={() => (open ? close() : openPicker())}
                className={`inline-flex h-[38px] items-center gap-2 rounded-xl border border-brand-line bg-background px-3.5 font-[family-name:var(--font-display)] text-base font-bold text-foreground ${focusRing}`}
              >
                <span aria-live="polite">{monthTitle(first, last)}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className={`transition-transform ${open ? "rotate-180" : ""}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {open && (
                <div
                  ref={popRef}
                  role="dialog"
                  aria-label="Choose dates"
                  className="absolute left-0 top-11 z-20 w-[264px] rounded-2xl border border-brand-line bg-background p-3 shadow-[0_10px_30px_rgba(13,32,32,.15)]"
                >
                  <div className="mb-2 flex gap-1.5">
                    {[3, 7].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => shortcut(k)}
                        className={`h-[30px] flex-1 rounded-full border border-brand-line text-[13px] font-semibold text-foreground hover:bg-brand-teal-wash ${focusRing}`}
                      >
                        {k} days
                      </button>
                    ))}
                  </div>
                  <p className="mb-2 rounded-lg bg-brand-teal-wash px-2 py-1.5 text-xs font-semibold text-brand-accent" aria-live="polite">
                    {anchor === null ? "Or pick a start day" : "Now pick an end day"}
                  </p>
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      aria-label="Previous month"
                      disabled={month <= months[0]}
                      onClick={() => setMonth((m) => addMonths(m, -1))}
                      className={`grid size-7 place-items-center rounded-lg border border-brand-line text-sm text-foreground disabled:opacity-35 ${focusRing}`}
                    >
                      ‹
                    </button>
                    <h4 className="font-[family-name:var(--font-display)] text-sm font-bold text-foreground">
                      {fmt(`${month}-01`, { month: "long", year: "numeric" })}
                    </h4>
                    <button
                      type="button"
                      aria-label="Next month"
                      disabled={month >= months[months.length - 1]}
                      onClick={() => setMonth((m) => addMonths(m, 1))}
                      className={`grid size-7 place-items-center rounded-lg border border-brand-line text-sm text-foreground disabled:opacity-35 ${focusRing}`}
                    >
                      ›
                    </button>
                  </div>
                  <div
                    className="grid grid-cols-7 gap-0.5 text-center text-[11.5px]"
                    onMouseLeave={() => setHover(null)}
                  >
                    {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
                      <div key={i} className="py-0.5 font-semibold text-brand-muted" aria-hidden>
                        {w}
                      </div>
                    ))}
                    {monthCells(month).map((iso, i) => {
                      if (!iso) return <div key={`b${i}`} />;
                      const idx = days.indexOf(iso);
                      const trip = idx >= 0;
                      let inView: boolean;
                      if (anchor !== null && trip) {
                        const other = hover ?? anchor;
                        inView = idx >= Math.min(anchor, other) && idx <= Math.max(anchor, other);
                      } else {
                        inView = trip && idx >= start && idx < start + n;
                      }
                      const day = Number(iso.slice(8));
                      const name = fmt(iso, { day: "numeric", month: "long" });
                      return (
                        <button
                          key={iso}
                          type="button"
                          data-trip={trip}
                          data-in={inView}
                          disabled={!trip}
                          tabIndex={trip ? 0 : -1}
                          aria-label={`${name}${inView ? ", selected" : ""}`}
                          aria-pressed={trip ? inView : undefined}
                          onClick={() => trip && pickDay(idx)}
                          onMouseEnter={() => trip && setHover(idx)}
                          onFocus={() => trip && setHover(idx)}
                          className={`relative h-8 rounded-md text-xs font-medium tabular-nums ${focusRing} ${
                            inView
                              ? "rounded-none bg-brand-teal-wash font-bold text-brand-accent"
                              : trip
                                ? "text-foreground hover:bg-brand-teal-wash"
                                : "cursor-default text-brand-muted/60"
                          }`}
                        >
                          {day}
                          {trip && (
                            <span aria-hidden className="absolute bottom-0.5 left-1/2 size-[3px] -translate-x-1/2 rounded-full bg-brand-accent" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="Previous days"
              disabled={start <= 0}
              onClick={() => setStart((s) => clampStart(s - n, n))}
              className={`grid size-[34px] place-items-center rounded-[10px] border border-brand-line bg-background text-base text-foreground disabled:opacity-35 ${focusRing}`}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next days"
              disabled={start + n >= len}
              onClick={() => setStart((s) => clampStart(s + n, n))}
              className={`grid size-[34px] place-items-center rounded-[10px] border border-brand-line bg-background text-base text-foreground disabled:opacity-35 ${focusRing}`}
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setStart(0)}
              className={`h-[34px] rounded-[10px] border border-brand-line bg-background px-3.5 text-[13px] font-semibold text-foreground ${focusRing}`}
            >
              Trip start
            </button>
          </>
        ) : (
          <span className="px-1 font-[family-name:var(--font-display)] text-base font-bold text-foreground">
            {rangeLabel(days[0], days[len - 1])}
          </span>
        )}
        <span className="hidden flex-1 sm:block" />
        <div role="group" aria-label="Calendar mode" className="flex w-fit gap-0.5 rounded-full border border-brand-line bg-background p-[3px]">
          <button
            type="button"
            aria-pressed={mode === "itinerary"}
            onClick={() => {
              close(false);
              setMode("itinerary");
            }}
            className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${focusRing} ${
              mode === "itinerary" ? "bg-foreground text-background" : "text-brand-muted hover:text-foreground"
            }`}
          >
            Itinerary
          </button>
          <button
            type="button"
            aria-pressed={mode === "days"}
            aria-haspopup="dialog"
            onClick={() => (open ? close() : openPicker())}
            className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${focusRing} ${
              mode === "days" ? "bg-foreground text-background" : "text-brand-muted hover:text-foreground"
            }`}
          >
            {mode === "days" ? lengthLabel : "Select days"}
          </button>
        </div>
      </div>

      {mode === "days" ? <DayGrid shown={shown} spans={spans} byDate={byDate} /> : <Itinerary days={days} byDate={byDate} />}

      <StatusLegend />

      {unscheduled.length > 0 && (
        <div className="border-t border-brand-line pt-5">
          <div className="mb-2.5 text-xs font-bold text-brand-muted">Not yet scheduled</div>
          <div className="flex flex-col gap-2">
            {unscheduled.map((el) => (
              <Link
                key={el.id}
                href={el.href}
                className={`flex items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-2.5 transition-opacity hover:opacity-90 ${TIER_CLASSES[el.tier]} ${focusRing}`}
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

function DayGrid({
  shown,
  spans,
  byDate,
}: {
  shown: string[];
  spans: OverviewElement[];
  byDate: Map<string, Entry[]>;
}) {
  const cols: CSSProperties = { gridTemplateColumns: `repeat(${shown.length}, minmax(96px, 1fr))` };
  const height = (HOUR_END - HOUR_START) * HOUR_PX;
  const firstDay = shown[0];
  const lastDay = shown[shown.length - 1];

  // All-day row: stays as one band across their dates, plus anything dated
  // but without a time.
  const bands = spans
    .map((el) => {
      const s = el.schedule!.span!;
      const a = s.start < firstDay ? firstDay : s.start;
      const b = s.end > lastDay ? lastDay : s.end;
      return a <= b ? { el, from: shown.indexOf(a), to: shown.indexOf(b) } : null;
    })
    .filter((x): x is { el: OverviewElement; from: number; to: number } => Boolean(x && x.from >= 0 && x.to >= 0));
  const untimed = shown.flatMap((date, col) =>
    (byDate.get(date) ?? []).filter((e) => !e.el.schedule?.span && !e.occ.time).map((e) => ({ ...e, col })),
  );

  return (
    <div className="overflow-x-auto rounded-2xl border border-brand-line bg-background">
      <div style={{ minWidth: 44 + shown.length * 96 }}>
        {/* day headers */}
        <div className="flex border-b border-brand-line">
          <div className="w-11 flex-none" />
          <div className="grid flex-1" style={cols}>
            {shown.map((d) => (
              <div key={d} className="border-l border-brand-line px-1.5 py-2 text-center">
                <div className="text-[11.5px] font-semibold tracking-wide text-brand-muted">
                  {fmt(d, { weekday: "short" }).toUpperCase()}
                </div>
                <div className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{Number(d.slice(8))}</div>
              </div>
            ))}
          </div>
        </div>

        {/* all-day row */}
        <div className="flex min-h-[34px] border-b border-brand-line py-1.5">
          <div className="w-11 flex-none pr-1.5 pt-1 text-right text-[10.5px] text-brand-muted">all day</div>
          <div className="grid flex-1 gap-y-1" style={{ ...cols, gridAutoFlow: "row dense" }}>
            {bands.map(({ el, from, to }) => (
              <Link
                key={el.id}
                href={el.href}
                style={{ gridColumn: `${from + 1} / ${to + 2}` }}
                className={`mx-1 truncate rounded-lg border-[1.5px] px-2 py-0.5 text-xs font-semibold ${TIER_CLASSES[el.tier]} ${focusRing}`}
              >
                {el.symbol} · {el.label}
              </Link>
            ))}
            {untimed.map(({ el, occ, col }) => (
              <Link
                key={`${el.id}-${occ.date}-${occ.label}`}
                href={el.href}
                style={{ gridColumn: `${col + 1} / ${col + 2}` }}
                className={`mx-1 truncate rounded-lg border-[1.5px] px-2 py-0.5 text-[11.5px] font-semibold ${TIER_CLASSES[el.tier]} ${focusRing}`}
                title={el.schedule?.isProposed ? `${el.label} (proposed)` : el.label}
              >
                {el.symbol} · {el.label}
                {occ.label ? `, ${occ.label.toLowerCase()}` : ""}
              </Link>
            ))}
          </div>
        </div>

        {/* time grid (bottom padding leaves room for the last hour label) */}
        <div className="flex pb-2">
          <div className="relative w-11 flex-none" style={{ height }} aria-hidden>
            {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10.5px] text-brand-muted"
                style={{ top: Math.max((h - HOUR_START) * HOUR_PX, 7) }}
              >
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div className="grid flex-1" style={cols}>
            {shown.map((date) => (
              <DayColumn key={date} entries={(byDate.get(date) ?? []).filter((e) => !e.el.schedule?.span && e.occ.time)} height={height} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({ entries, height }: { entries: Entry[]; height: number }) {
  // Place each event, then split overlapping ones side by side.
  const placed = entries
    .map((e) => {
      const s = toMinutes(e.occ.time!);
      const known = e.occ.endTime ? toMinutes(e.occ.endTime) : NaN;
      const end = known > s ? known : s + (DEFAULT_MINUTES[e.el.type] ?? 90);
      return { ...e, s, end };
    })
    .sort((a, b) => a.s - b.s);
  const lanes: number[] = [];
  const laneOf = placed.map((p) => {
    let i = lanes.findIndex((laneEnd) => laneEnd <= p.s);
    if (i < 0) i = lanes.push(0) - 1;
    lanes[i] = p.end;
    return i;
  });
  const laneCount = Math.max(1, lanes.length);

  return (
    <div
      className="relative border-l border-brand-line"
      style={{
        height,
        backgroundImage: "linear-gradient(var(--brand-line) 1px, transparent 1px)",
        backgroundSize: `100% ${HOUR_PX}px`,
      }}
    >
      {placed.map((p, i) => {
        const top = Math.max(0, ((p.s - HOUR_START * 60) / 60) * HOUR_PX);
        const bottom = Math.min(height, ((p.end - HOUR_START * 60) / 60) * HOUR_PX);
        const h = Math.max(bottom - top - 2, MIN_EVENT_PX);
        const w = 100 / laneCount;
        return (
          <Link
            key={`${p.el.id}-${p.occ.label}-${i}`}
            href={p.el.href}
            className={`absolute overflow-hidden rounded-[9px] border-[1.5px] px-1.5 py-1 text-[11.5px] leading-tight transition-opacity hover:opacity-90 ${TIER_CLASSES[p.el.tier]} ${focusRing}`}
            style={{ top: Math.min(top, height - MIN_EVENT_PX), height: h, left: `calc(${laneOf[i] * w}% + 3px)`, width: `calc(${w}% - 6px)` }}
          >
            <b className="block truncate text-xs font-bold">
              {p.el.symbol} · {p.el.label}
              {p.occ.label ? `, ${p.occ.label.toLowerCase()}` : ""}
            </b>
            <span className="opacity-80">{timeText(p.occ)}</span>
          </Link>
        );
      })}
    </div>
  );
}

function Itinerary({ days, byDate }: { days: string[]; byDate: Map<string, Entry[]> }) {
  // Check-in leads its day, check-out closes it, timed events in between.
  const order = (e: Entry) =>
    e.occ.label === "Check-in" ? -1 : e.occ.label === "Check-out" ? 10_000 : e.occ.time ? toMinutes(e.occ.time) : 9_000;
  return (
    <div className="flex flex-col gap-3">
      {days.map((date) => {
        const entries = [...(byDate.get(date) ?? [])].sort((a, b) => order(a) - order(b));
        return (
          <div
            key={date}
            className="grid grid-cols-[64px_1fr] gap-3.5 rounded-2xl border border-brand-line bg-background px-3.5 py-3 sm:grid-cols-[78px_1fr]"
          >
            <div>
              <b className="block font-[family-name:var(--font-display)] text-xl font-bold text-foreground">
                {fmt(date, { day: "numeric", month: "short" })}
              </b>
              <span className="text-xs font-semibold tracking-wide text-brand-muted">{fmt(date, { weekday: "short" }).toUpperCase()}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              {entries.length === 0 ? (
                <p className="py-1.5 text-[13px] text-brand-muted">Nothing planned</p>
              ) : (
                entries.map(({ el, occ }) => {
                  const isStay = occ.label === "Check-in" || occ.label === "Check-out";
                  const name = isStay
                    ? `${occ.label === "Check-in" ? "Check in" : "Check out"}, ${el.label}`
                    : occ.label
                      ? `${el.label}, ${occ.label.toLowerCase()}`
                      : el.label;
                  const time = isStay
                    ? occ.time
                      ? `${occ.label === "Check-in" ? "from" : "by"} ${occ.time}`
                      : null
                    : (timeText(occ) ?? (el.schedule?.isProposed ? "Proposed" : null));
                  return (
                    <Link
                      key={`${el.id}-${occ.label}`}
                      href={el.href}
                      className={`flex items-center gap-3 rounded-xl border-[1.5px] px-3 py-2 text-[13.5px] transition-opacity hover:opacity-90 ${TIER_CLASSES[el.tier]} ${focusRing}`}
                    >
                      <span className="grid size-[30px] flex-none place-items-center rounded-lg border border-current font-[family-name:var(--font-display)] text-xs font-bold opacity-90">
                        {el.symbol}
                      </span>
                      <b className="min-w-0 truncate font-semibold">{name}</b>
                      {time && <span className="ml-auto flex-none text-right text-[12.5px] tabular-nums opacity-85">{time}</span>}
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
