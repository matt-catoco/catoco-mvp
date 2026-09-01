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
          <PriceField
            price={str("price")}
            currency={str("currency")}
            onChangePrice={(v) => set("price", v)}
            onChangeCurrency={(v) => set("currency", v)}
          />
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
          <PriceField
            price={str("price")}
            currency={str("currency")}
            onChangePrice={(v) => set("price", v)}
            onChangeCurrency={(v) => set("currency", v)}
          />
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
  // the value so re-opening a partially-filled option lands in the right
  // mode. The two modes are independent, not derived from each other —
  // Nights means "we know the length, not yet when" (no start date at all,
  // suggesting one would be misleading); Exact dates means real anchored
  // dates. Switching modes clears the other mode's fields.
  const [mode, setMode] = useState<"exact" | "nights">(str("nights") ? "nights" : "exact");

  function switchMode(next: "exact" | "nights") {
    setMode(next);
    if (next === "nights") {
      onChange({ ...value, start_date: "", end_date: "" });
    } else {
      onChange({ ...value, nights: "" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ModeToggle
        value={mode}
        onChange={switchMode}
        options={[
          { value: "exact", label: "Exact dates" },
          { value: "nights", label: "Nights" },
        ]}
      />

      {mode === "exact" ? (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Start date</span>
            <input
              type="date"
              className={field}
              value={str("start_date")}
              onChange={(e) => onChange({ ...value, start_date: e.target.value })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>End date</span>
            <input
              type="date"
              className={field}
              value={str("end_date")}
              min={str("start_date") || undefined}
              onChange={(e) => onChange({ ...value, end_date: e.target.value })}
            />
          </label>
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={label}>Nights</span>
          <input
            type="number"
            min={1}
            step={1}
            className={`${field} max-w-[120px]`}
            placeholder="7"
            value={str("nights")}
            onChange={(e) => onChange({ ...value, nights: e.target.value })}
          />
        </label>
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
  price,
  currency,
  onChangePrice,
  onChangeCurrency,
}: {
  price: string;
  currency: string;
  onChangePrice: (v: string) => void;
  onChangeCurrency: (v: string) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className={label}>Estimated price (optional)</span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          className={`${field} max-w-[140px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
          placeholder="0"
          value={price}
          onChange={(e) => onChangePrice(e.target.value)}
        />
      </label>
      <select
        className={`${field} w-24`}
        value={currency || "USD"}
        onChange={(e) => onChangeCurrency(e.target.value)}
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}
