"use client";

import { useState } from "react";
import { CURRENCIES, PRICING_BASES, PRICING_BASIS_LABELS, type ElementType } from "@/lib/trip-elements";
import { fieldClass, labelClass, pillInactive } from "@/lib/ui";

// Shared between the trip-creation wizard (app/trips/new) and the post-
// creation option-submission form (app/trips/[tripId]) — same input shapes,
// same validation, so it lives here rather than under either caller's folder.

const field = `h-10 ${fieldClass}`;
const label = labelClass;

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
            value === o.value ? "border-transparent bg-foreground text-background" : pillInactive
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
            placeholder="Booking link (required) — e.g. a flight or booking page"
            required
            value={str("booking_link")}
            onChange={(e) => set("booking_link", e.target.value)}
          />
          <PriceField
            price={str("price")}
            currency={str("currency")}
            pricingBasis={str("pricing_basis")}
            onChangePrice={(v) => set("price", v)}
            onChangeCurrency={(v) => set("currency", v)}
            onChangePricingBasis={(v) => set("pricing_basis", v)}
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
            placeholder="Booking link (required) — e.g. an Airbnb, hotel, or restaurant page"
            required
            value={str("booking_link")}
            onChange={(e) => set("booking_link", e.target.value)}
          />
          <PriceField
            price={str("price")}
            currency={str("currency")}
            pricingBasis={str("pricing_basis")}
            onChangePrice={(v) => set("price", v)}
            onChangeCurrency={(v) => set("currency", v)}
            onChangePricingBasis={(v) => set("pricing_basis", v)}
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
  // dates.
  const [mode, setMode] = useState<"exact" | "nights">(str("nights") ? "nights" : "exact");

  // Bug fix: switching modes used to wipe whatever was typed in the other
  // mode by clearing it straight out of the submitted value. Each mode's
  // fields now live in their own local state instead, seeded once from the
  // incoming value — switching modes never touches the other mode's state,
  // it just changes which one gets merged into what's actually submitted
  // (normalizeOptionValue only ever looks at one shape at a time anyway).
  const [startDate, setStartDate] = useState(str("start_date"));
  const [endDate, setEndDate] = useState(str("end_date"));
  const [nights, setNights] = useState(str("nights"));
  const [flexDays, setFlexDays] = useState(str("flexibility_days"));

  function emit(next: {
    mode: "exact" | "nights";
    startDate: string;
    endDate: string;
    nights: string;
    flexDays: string;
  }) {
    const shape =
      next.mode === "nights"
        ? { nights: next.nights }
        : { start_date: next.startDate, end_date: next.endDate, flexibility_days: next.flexDays };
    onChange(shape);
  }

  function switchMode(next: "exact" | "nights") {
    setMode(next);
    emit({ mode: next, startDate, endDate, nights, flexDays });
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
            <span className={label}>
              Start date <span className="text-red-500">*</span>
            </span>
            <input
              type="date"
              required
              className={field}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                emit({ mode, startDate: e.target.value, endDate, nights, flexDays });
              }}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>
              End date <span className="text-red-500">*</span>
            </span>
            <input
              type="date"
              required
              className={field}
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value);
                emit({ mode, startDate, endDate: e.target.value, nights, flexDays });
              }}
            />
          </label>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className={label}>Nights</span>
            <input
              type="number"
              min={1}
              step={1}
              className={`${field} max-w-[120px]`}
              placeholder="7"
              value={nights}
              onChange={(e) => {
                setNights(e.target.value);
                emit({ mode, startDate, endDate, nights: e.target.value, flexDays });
              }}
            />
          </label>
          <p className="rounded-lg bg-brand-teal-wash px-3 py-2 text-xs text-brand-teal-deep">
            Submitting this will also create a second Dates element (in exact-dates mode, sized to
            this many nights) for the group to pin down actual calendar dates once this locks in.
          </p>
        </>
      )}

      {mode === "exact" && (
        <label className="flex flex-col gap-1">
          <span className={label}>Flexibility (optional)</span>
          <select
            className={`${field} w-40`}
            value={flexDays}
            onChange={(e) => {
              setFlexDays(e.target.value);
              emit({ mode, startDate, endDate, nights, flexDays: e.target.value });
            }}
          >
            <option value="">Exact dates only</option>
            <option value="1">± 1 day</option>
            <option value="2">± 2 days</option>
            <option value="3">± 3 days</option>
          </select>
        </label>
      )}
    </div>
  );
}

function PriceField({
  price,
  currency,
  pricingBasis,
  onChangePrice,
  onChangeCurrency,
  onChangePricingBasis,
}: {
  price: string;
  currency: string;
  pricingBasis: string;
  onChangePrice: (v: string) => void;
  onChangeCurrency: (v: string) => void;
  onChangePricingBasis: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
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
      {price.trim() && (
        <label className="flex flex-col gap-1">
          <span className={label}>Price is per</span>
          <select
            className={`${field} w-44`}
            value={pricingBasis}
            onChange={(e) => onChangePricingBasis(e.target.value)}
          >
            {PRICING_BASES.map((b) => (
              <option key={b} value={b}>
                {PRICING_BASIS_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
