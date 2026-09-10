// Trip overview — Itinerary/Calendar views need to know *when* an element
// happens, but there's no single "date" column anywhere in the schema —
// scheduling info is scattered across a few loosely-typed places, differs
// per type, and is often just plain absent. This is the one place that
// reconciles all of that into a normalized shape both views can render
// without re-deriving the logic themselves.
//
// What's actually available, per type (confirmed by reading every date-ish
// field currently written anywhere in the app, 2026-09-xx):
//   - Dates/Destination: never a scheduled item at all — Dates defines the
//     trip's own day range (used to build the Itinerary/Calendar day grid
//     itself), Destination is pure context. Neither ever appears as a row
//     in either view.
//   - Travel: `depart_date`/`return_date` (or, for rental cars,
//     `pickup_datetime`/`dropoff_datetime` — named "datetime" but actually
//     just a date, same as everywhere else here) — up to two distinct
//     point-in-time legs, never a time of day.
//   - Accommodation: `dates.start_date`/`dates.end_date` — a real span
//     (check-in through check-out), never a time of day.
//   - Dining: `date` + `dining_time` (an actual HH:MM), both optional, from
//     either the search modal or manual entry. Falls back to the
//     element-level `metadata.date` when `date` is unset.
//   - Experience: `date`/`time` (both optional — a candidate can be
//     genuinely undated), from either the search modal or manual entry.
//     Falls back to the element-level `metadata.date` when unset, same as
//     Dining.
// Before an element locks, its own candidate options could each carry a
// different date (every priced type now) — rather than guess at a
// "leading" candidate, every type falls back to the same one thing
// pre-lock: the element-level `metadata.date`, which exists on every
// scheduled type for exactly this purpose. A locked option's own date/time
// only ever applies once it's actually locked, so this keeps one
// consistent pre-lock rule instead of a type-specific story per type.

import type { ElementState, ElementType } from "./trip-elements";

export type ScheduleOccurrence = {
  date: string; // ISO YYYY-MM-DD
  time: string | null; // HH:MM, only ever set for a locked Dining option
  label: string; // "" for single-touchpoint types, "Check-in"/"Check-out"/"Departure"/"Return" otherwise
};

export type ElementSchedule = {
  occurrences: ScheduleOccurrence[]; // 1–2 dated touchpoints, chronological
  span: { start: string; end: string } | null; // multi-day banner range — Accommodation only
  // True when this came from the element-level metadata.date fallback
  // rather than a locked option's own fields — i.e. a guess, not a
  // decision. Always true for an open (not-yet-locked) element.
  isProposed: boolean;
};

function trimmed(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

/**
 * Derives an element's schedule from its element-level metadata and (if
 * locked) its locked option's value. Returns null when there's no date
 * signal at all — the caller buckets those under "not yet scheduled."
 * Dates/Destination always return null — see the file doc comment.
 */
export function getElementSchedule(
  type: ElementType,
  state: ElementState,
  metadata: Record<string, string> | null | undefined,
  lockedValue: Record<string, unknown> | null | undefined,
): ElementSchedule | null {
  const metaDate = trimmed(metadata?.date);

  if (state === "open" || !lockedValue) {
    return metaDate
      ? { occurrences: [{ date: metaDate, time: null, label: "" }], span: null, isProposed: true }
      : null;
  }

  switch (type) {
    case "accommodation": {
      const dates = (lockedValue.dates ?? {}) as Record<string, unknown>;
      const start = trimmed(dates.start_date) ?? metaDate;
      const end = trimmed(dates.end_date);
      if (!start) return null;
      if (end && end !== start) {
        return {
          occurrences: [
            { date: start, time: null, label: "Check-in" },
            { date: end, time: null, label: "Check-out" },
          ],
          span: { start, end },
          isProposed: false,
        };
      }
      return { occurrences: [{ date: start, time: null, label: "" }], span: null, isProposed: false };
    }
    case "travel": {
      const depart = trimmed(lockedValue.depart_date) ?? trimmed(lockedValue.pickup_datetime) ?? metaDate;
      const ret = trimmed(lockedValue.return_date) ?? trimmed(lockedValue.dropoff_datetime);
      if (!depart) return null;
      const occurrences: ScheduleOccurrence[] = [
        { date: depart, time: null, label: ret ? "Departure" : "" },
      ];
      if (ret && ret !== depart) occurrences.push({ date: ret, time: null, label: "Return" });
      return { occurrences, span: null, isProposed: false };
    }
    case "dining": {
      // Own field first, metadata fallback — same rule as every other type
      // here now that the option itself can actually carry a date (see
      // normalizeOptionValue's dining case).
      const start = trimmed(lockedValue.date) ?? metaDate;
      if (!start) return null;
      return {
        occurrences: [{ date: start, time: trimmed(lockedValue.dining_time), label: "" }],
        span: null,
        isProposed: false,
      };
    }
    case "experience": {
      // The locked candidate's own date/time (a real tour/show start time,
      // when one was set) wins over the element-level metadata.date guess —
      // same "own field first, metadata fallback" rule as Travel/
      // Accommodation above.
      const start = trimmed(lockedValue.date) ?? metaDate;
      if (!start) return null;
      return {
        occurrences: [{ date: start, time: trimmed(lockedValue.time), label: "" }],
        span: null,
        isProposed: false,
      };
    }
    default: // dates, destination
      return null;
  }
}

/** Inclusive list of ISO (YYYY-MM-DD) dates from start to end. */
export function isoDateRange(start: string, end: string): string[] {
  const [sy, sm, sd] = start.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = end.slice(0, 10).split("-").map(Number);
  const out: string[] = [];
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));
  while (cur.getTime() <= last.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** "Sat" / "Sep 12" — day headers for Itinerary/Calendar, UTC-parsed for the
 * same reason formatDate() is (see lib/trip-elements.ts). */
export function formatDayHeader(iso: string): { weekday: string; dateLabel: string } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    dateLabel: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

/** "3:45 PM" from a bare "15:45" HH:MM — the only real time-of-day value
 * anywhere in the schema (Dining's dining_time). */
export function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const date = new Date(Date.UTC(2000, 0, 1, h, m));
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}
