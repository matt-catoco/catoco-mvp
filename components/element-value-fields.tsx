"use client";

import { useState } from "react";
import { CURRENCIES, type ElementType } from "@/lib/trip-elements";

// Shared between the trip-creation wizard (app/trips/new) and the post-
// creation option-submission form (app/trips/[tripId]) — same input shapes,
// same validation, so it lives here rather than under either caller's folder.

const field =
  "h-10 w-full rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";
const label = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

function ModeToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "border-transparent bg-foreground text-background"
              : "border-black/[.12] text-zinc-600 hover:bg-black/[.03] dark:border-white/[.16] dark:text-zinc-400 dark:hover:bg-white/[.05]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Pure calendar-date arithmetic in UTC — deliberately NOT `new Date(str)` +
// local setDate/getDate, which shifts by a day in any timezone ahead of UTC
// (e.g. Europe, Asia, Australia): local midnight there is still "yesterday"
// in UTC, so toISOString() rounds down. Date.UTC() sidesteps local time
// entirely and correctly normalizes day-of-month overflow across months/years.
function addNights(startDateStr: string, nights: number): string {
  const [y, m, d] = startDateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d + nights)).toISOString().slice(0, 10);
}

function nightsBetween(startStr: string, endStr: string): string {
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return "";
  const diff = Math.round(
    (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000,
  );
  return diff > 0 ? String(diff) : "";
}

export function ElementValueFields({
  type,
  value,
  onChange,
}: {
  type: ElementType;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const str = (key: string) => String(value[key] ?? "");

  switch (type) {
    case "dates":
      return <DatesFields value={value} onChange={onChange} />;

    case "destination":
      return (
        <input
          className={field}
          placeholder="e.g. Lisbon, Portugal"
          value={str("name")}
          onChange={(e) => set("name", e.target.value)}
        />
      );

    case "budget": {
      const mode = str("mode") === "range" ? "range" : "single";
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <ModeToggle
              value={mode}
              onChange={(v) => set("mode", v)}
              options={[
                { value: "single", label: "Single amount" },
                { value: "range", label: "Range" },
              ]}
            />
            <label className="flex flex-col gap-1">
              <span className={label}>Currency</span>
              <select
                className={`${field} w-24`}
                value={str("currency") || "USD"}
                onChange={(e) => set("currency", e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mode === "range" ? (
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className={label}>Min per person</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  className={field}
                  placeholder="800"
                  value={str("min")}
                  onChange={(e) => set("min", e.target.value)}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={label}>Max per person</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  className={field}
                  placeholder="1500"
                  value={str("max")}
                  onChange={(e) => set("max", e.target.value)}
                />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={label}>Amount per person</span>
              <input
                type="number"
                min={1}
                step="any"
                className={field}
                placeholder="1200"
                value={str("amount")}
                onChange={(e) => set("amount", e.target.value)}
              />
            </label>
          )}
        </div>
      );
    }

    case "participants":
      return (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Minimum</span>
            <input
              type="number"
              min={1}
              step={1}
              className={field}
              placeholder="e.g. 4"
              value={str("min")}
              onChange={(e) => set("min", e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Maximum (optional)</span>
            <input
              type="number"
              min={1}
              step={1}
              className={field}
              placeholder="e.g. 8"
              value={str("max")}
              onChange={(e) => set("max", e.target.value)}
            />
          </label>
        </div>
      );

    case "travel":
      return (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder="Mode — e.g. flights, train, road trip"
            value={str("mode")}
            onChange={(e) => set("mode", e.target.value)}
          />
          <input
            className={field}
            placeholder="Note (optional)"
            value={str("note")}
            onChange={(e) => set("note", e.target.value)}
          />
          <input
            type="url"
            className={field}
            placeholder="Booking link (optional) — e.g. a flight or booking page"
            value={str("booking_link")}
            onChange={(e) => set("booking_link", e.target.value)}
          />
          <PriceField value={str("price")} onChange={(v) => set("price", v)} />
        </div>
      );

    // accommodation | experience | dining
    default:
      return (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder="Name"
            value={str("name")}
            onChange={(e) => set("name", e.target.value)}
          />
          <input
            type="url"
            className={field}
            placeholder="Booking link (optional) — e.g. an Airbnb, hotel, or restaurant page"
            value={str("booking_link")}
            onChange={(e) => set("booking_link", e.target.value)}
          />
          <PriceField value={str("price")} onChange={(v) => set("price", v)} />
        </div>
      );
  }
}

function DatesFields({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const str = (k: string) => String(value[k] ?? "");
  // UI-only: which entry mode is active. Seeded from whatever's already in
  // the value so re-opening a partially-filled option lands in the right mode.
  const [mode, setMode] = useState<"exact" | "length">(
    str("duration_nights") && !str("end_date") ? "length" : "exact",
  );

  const setStart = (startDate: string) => {
    if (mode === "length" && str("duration_nights")) {
      onChange({
        ...value,
        start_date: startDate,
        end_date: addNights(startDate, Number(value.duration_nights)),
      });
    } else {
      onChange({ ...value, start_date: startDate });
    }
  };

  const setEnd = (endDate: string) => {
    onChange({
      ...value,
      end_date: endDate,
      duration_nights: nightsBetween(str("start_date"), endDate),
    });
  };

  const setDuration = (nights: string) => {
    const n = Number(nights);
    const start = str("start_date");
    onChange({
      ...value,
      duration_nights: nights,
      end_date: start && Number.isInteger(n) && n > 0 ? addNights(start, n) : "",
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <ModeToggle
        value={mode}
        onChange={setMode}
        options={[
          { value: "exact", label: "Exact dates" },
          { value: "length", label: "Start + length" },
        ]}
      />

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className={label}>Start date</span>
          <input
            type="date"
            className={field}
            value={str("start_date")}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        {mode === "exact" ? (
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>End date</span>
            <input
              type="date"
              className={field}
              value={str("end_date")}
              min={str("start_date") || undefined}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        ) : (
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Nights</span>
            <input
              type="number"
              min={1}
              step={1}
              className={field}
              placeholder="7"
              value={str("duration_nights")}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
        )}
      </div>

      {mode === "length" && str("end_date") && (
        <p className="text-xs text-zinc-500">Ends {str("end_date")}</p>
      )}

      <label className="flex flex-col gap-1">
        <span className={label}>Flexibility (optional)</span>
        <select
          className={`${field} w-40`}
          value={str("flexibility_days")}
          onChange={(e) => onChange({ ...value, flexibility_days: e.target.value })}
        >
          <option value="">Exact dates only</option>
          <option value="1">± 1 day</option>
          <option value="2">± 2 days</option>
          <option value="3">± 3 days</option>
        </select>
      </label>
    </div>
  );
}

function PriceField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={label}>Estimated price (optional)</span>
      <input
        type="number"
        min={0}
        step="any"
        className={`${field} max-w-[160px]`}
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
