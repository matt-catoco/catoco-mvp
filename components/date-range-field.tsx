"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/trip-elements";
import { fieldClass, labelClass } from "@/lib/ui";

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One month grid with the selected range highlighted — teal endpoints,
 * teal-wash between. Pure display + day clicks; the caller decides what a
 * click means (DateRangeField: start then end; DatesFields: same, inline).
 * Days before `minDate` are disabled.
 */
export function RangeCalendar({
  startDate,
  endDate,
  onDayClick,
  minDate,
}: {
  startDate: string;
  endDate: string;
  onDayClick: (iso: string) => void;
  minDate?: string;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const anchor = startDate || minDate;
    const base = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const toISO = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-line p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          aria-label="Previous month"
          className="rounded-full px-2 py-1 text-brand-muted transition-colors hover:bg-brand-teal-wash hover:text-brand-teal-deep"
        >
          ‹
        </button>
        <span className="text-sm font-semibold">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          aria-label="Next month"
          className="rounded-full px-2 py-1 text-brand-muted transition-colors hover:bg-brand-teal-wash hover:text-brand-teal-deep"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map((d) => (
          <div key={d} className="text-center text-[11px] font-semibold text-brand-muted">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;
          const iso = toISO(day);
          const disabled = Boolean(minDate && iso < minDate);
          const isEndpoint = iso === startDate || iso === endDate;
          const inRange = Boolean(startDate && endDate && iso > startDate && iso < endDate);
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => onDayClick(iso)}
              className={`aspect-square rounded-lg text-xs font-medium transition-colors ${
                isEndpoint
                  ? "bg-brand-teal-deep text-white"
                  : inRange
                    ? "bg-brand-teal-wash text-brand-teal-deep"
                    : disabled
                      ? "cursor-not-allowed text-brand-muted/40"
                      : "text-foreground hover:bg-brand-teal-wash"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Start/end date pair for anything round-trip — depart/return, check-in/
 * check-out, pickup/drop-off. Two field-styled buttons over one calendar:
 * picking the start automatically moves on to the end, picking the end
 * closes it. `single` (one-way) shows just the start. Picking an end before
 * the start restarts the range from that day.
 */
export function DateRangeField({
  startLabel,
  endLabel,
  startDate,
  endDate,
  onChange,
  single = false,
  required = false,
  minDate = todayIso(),
}: {
  startLabel: string;
  endLabel: string;
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  single?: boolean;
  required?: boolean;
  /** Earliest selectable day; defaults to today. Pass "" to allow any. */
  minDate?: string;
}) {
  const [active, setActive] = useState<"start" | "end" | null>(null);
  // Remount the calendar on each open so it lands on the relevant month.
  const [openCount, setOpenCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setActive(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [active]);

  function open(which: "start" | "end") {
    if (!active) setOpenCount((n) => n + 1);
    setActive(which === "end" && !startDate ? "start" : which);
  }

  function pick(iso: string) {
    if (single) {
      onChange(iso, "");
      setActive(null);
      return;
    }
    if (active === "start" || !startDate || iso < startDate) {
      // New start: keep an existing end only if it's still after it.
      onChange(iso, endDate && endDate > iso ? endDate : "");
      setActive("end");
      return;
    }
    onChange(startDate, iso);
    setActive(null);
  }

  const star = required ? <span className="text-red-500"> *</span> : null;
  const box = (which: "start" | "end", text: string, value: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={labelClass}>
        {text}
        {star}
      </span>
      <button
        type="button"
        onClick={() => (active === which ? setActive(null) : open(which))}
        className={`h-10 truncate text-left ${fieldClass} ${
          active === which ? "border-brand-teal-deep" : ""
        } ${value ? "" : "text-brand-muted"}`}
      >
        {value ? formatDate(value) : "Select date"}
      </button>
    </label>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="flex gap-3">
        {box("start", startLabel, startDate)}
        {!single && box("end", endLabel, endDate)}
      </div>
      {active && (
        <div className="flex flex-col gap-1">
          {!single && (
            <p className="text-xs text-brand-muted">
              {active === "start" ? `Select ${startLabel.toLowerCase()}` : `Select ${endLabel.toLowerCase()}`}
            </p>
          )}
          <RangeCalendar
            key={openCount}
            startDate={startDate}
            endDate={single ? "" : endDate}
            onDayClick={pick}
            minDate={minDate || undefined}
          />
        </div>
      )}
    </div>
  );
}
