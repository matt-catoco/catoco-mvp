"use client";

import { useState } from "react";
import {
  CURRENCIES,
  PRICING_BASES,
  PRICING_BASIS_LABELS,
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  ACCOMMODATION_SUBTYPES,
  ACCOMMODATION_SUBTYPE_LABELS,
  ACCOMMODATION_SUBTYPE_FIELDS,
  ACCOMMODATION_FIELD_LABELS,
  EXPERIENCE_SUBTYPES,
  EXPERIENCE_SUBTYPE_LABELS,
  CUISINE_GROUPS,
  PRICING_TIERS,
  type ElementType,
  type TravelMode,
  type AccommodationSubtype,
  type AccommodationFieldKey,
  type ExperienceSubtype,
  type PricingTier,
} from "@/lib/trip-elements";
import { fieldClass, labelClass, pillInactive } from "@/lib/ui";
import { PlacePicker, type GeoPlaceValue } from "@/components/place-picker";

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
  requireDates = true,
}: {
  type: ElementType;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  // Travel's date(s) and Accommodations' check-in/out are required when
  // actually proposing/searching a candidate (submit-option-form.tsx,
  // vendor-search-modal.tsx) — that's where a real date belongs. The
  // organizer locking a value straight from Add Element is a lighter,
  // faster path that doesn't need that same rigor; false there.
  requireDates?: boolean;
}) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const str = (key: string) => String(value[key] ?? "");

  switch (type) {
    case "dates":
      return <DatesFields value={value} onChange={onChange} />;

    case "destination":
      return (
        <PlacePicker
          placeholder="e.g. Lisbon, Portugal"
          value={{ name: str("name"), lat: value.lat ? Number(value.lat) : undefined, lng: value.lng ? Number(value.lng) : undefined, place_id: str("place_id") || undefined }}
          onChange={(next: GeoPlaceValue) =>
            onChange({ ...value, name: next.name, lat: next.lat ?? "", lng: next.lng ?? "", place_id: next.place_id ?? "" })
          }
        />
      );

    case "travel": {
      const mode = str("mode") as TravelMode | "";
      const isOther = mode === "other";
      return (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className={label}>
              Mode <span className="text-red-500">*</span>
            </span>
            <select
              className={field}
              required
              value={mode}
              onChange={(e) => set("mode", e.target.value)}
            >
              <option value="">Select a mode</option>
              {TRAVEL_MODES.map((m) => (
                <option key={m} value={m}>
                  {TRAVEL_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          {isOther ? (
            <label className="flex flex-col gap-1">
              <span className={label}>
                Describe the mode <span className="text-red-500">*</span>
              </span>
              <input
                className={field}
                required
                placeholder="e.g. rideshare, private transfer"
                value={str("note")}
                onChange={(e) => set("note", e.target.value)}
              />
            </label>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  className={field}
                  placeholder="From"
                  value={str("start_location")}
                  onChange={(e) => set("start_location", e.target.value)}
                />
                <input
                  className={field}
                  placeholder="To"
                  value={str("destination_location")}
                  onChange={(e) => set("destination_location", e.target.value)}
                />
              </div>
              <ModeToggle
                value={value.round_trip === false ? "one_way" : "round_trip"}
                onChange={(v) => set("round_trip", v === "round_trip")}
                options={[
                  { value: "round_trip", label: "Round trip" },
                  { value: "one_way", label: "One-way" },
                ]}
              />
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className={label}>
                    Travel date {requireDates && <span className="text-red-500">*</span>}
                  </span>
                  <input
                    type="date"
                    required={requireDates}
                    className={field}
                    value={str("depart_date")}
                    onChange={(e) => set("depart_date", e.target.value)}
                  />
                </label>
                {value.round_trip !== false && (
                  <label className="flex flex-1 flex-col gap-1">
                    <span className={label}>
                      Return date {requireDates && <span className="text-red-500">*</span>}
                    </span>
                    <input
                      type="date"
                      required={requireDates}
                      className={field}
                      min={str("depart_date") || undefined}
                      value={str("return_date")}
                      onChange={(e) => set("return_date", e.target.value)}
                    />
                  </label>
                )}
              </div>
              <input
                className={field}
                placeholder="Note (optional)"
                value={str("note")}
                onChange={(e) => set("note", e.target.value)}
              />
            </>
          )}

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
            optional={isOther}
            onChangePrice={(v) => set("price", v)}
            onChangeCurrency={(v) => set("currency", v)}
            onChangePricingBasis={(v) => set("pricing_basis", v)}
          />
        </div>
      );
    }

    case "accommodation": {
      const subtype = str("subtype") as AccommodationSubtype | "";
      const fieldKeys = subtype ? ACCOMMODATION_SUBTYPE_FIELDS[subtype] : [];
      const fields = (value.accommodation_fields ?? {}) as Record<string, string>;
      const setField = (k: AccommodationFieldKey, v: string) =>
        set("accommodation_fields", { ...fields, [k]: v });

      return (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder="Name"
            value={str("name")}
            onChange={(e) => set("name", e.target.value)}
          />
          <label className="flex flex-col gap-1">
            <span className={label}>
              Property type <span className="text-red-500">*</span>
            </span>
            <select
              className={field}
              required
              value={subtype}
              onChange={(e) => set("subtype", e.target.value)}
            >
              <option value="">Select a type</option>
              {ACCOMMODATION_SUBTYPES.map((s) => (
                <option key={s} value={s}>
                  {ACCOMMODATION_SUBTYPE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          {fieldKeys.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {fieldKeys.map((k) => (
                <AccommodationField key={k} fieldKey={k} value={fields[k] ?? ""} onChange={(v) => setField(k, v)} />
              ))}
            </div>
          )}

          <div className="rounded-lg border border-brand-line p-2">
            <span className={`${label} mb-1 block`}>
              Dates {requireDates && <span className="text-red-500">*</span>}
            </span>
            <DatesFields
              value={(value.dates as Record<string, unknown>) ?? {}}
              onChange={(next) => set("dates", next)}
              required={requireDates}
              allowNights={false}
            />
          </div>

          <input
            type="url"
            className={field}
            placeholder="Booking link (required) — e.g. an Airbnb or hotel page"
            required
            value={str("booking_link")}
            onChange={(e) => set("booking_link", e.target.value)}
          />
          <PriceField
            price={str("price")}
            currency={str("currency")}
            pricingBasis={str("pricing_basis")}
            optional={subtype === "other"}
            onChangePrice={(v) => set("price", v)}
            onChangeCurrency={(v) => set("currency", v)}
            onChangePricingBasis={(v) => set("pricing_basis", v)}
          />
        </div>
      );
    }

    case "experience": {
      const subtype = str("experience_subtype") as ExperienceSubtype | "";
      return (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder="Name"
            value={str("name")}
            onChange={(e) => set("name", e.target.value)}
          />
          <label className="flex flex-col gap-1">
            <span className={label}>
              Category <span className="text-red-500">*</span>
            </span>
            <select
              className={field}
              required
              value={subtype}
              onChange={(e) => set("experience_subtype", e.target.value)}
            >
              <option value="">Select a category</option>
              {EXPERIENCE_SUBTYPES.map((s) => (
                <option key={s} value={s}>
                  {EXPERIENCE_SUBTYPE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <PlacePicker
            placeholder="Location (optional)"
            value={{
              name: str("location_name"),
              lat: value.location_lat ? Number(value.location_lat) : undefined,
              lng: value.location_lng ? Number(value.location_lng) : undefined,
              place_id: str("location_place_id") || undefined,
            }}
            onChange={(next: GeoPlaceValue) =>
              onChange({
                ...value,
                location_name: next.name,
                location_lat: next.lat ?? "",
                location_lng: next.lng ?? "",
                location_place_id: next.place_id ?? "",
              })
            }
          />
          <input
            type="url"
            className={field}
            placeholder="Booking link (required) — e.g. a tour or ticketing page"
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

    case "dining": {
      return (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder="Name"
            value={str("name")}
            onChange={(e) => set("name", e.target.value)}
          />
          <PlacePicker
            placeholder="Location (optional)"
            value={{
              name: str("location_name"),
              lat: value.location_lat ? Number(value.location_lat) : undefined,
              lng: value.location_lng ? Number(value.location_lng) : undefined,
              place_id: str("location_place_id") || undefined,
            }}
            onChange={(next: GeoPlaceValue) =>
              onChange({
                ...value,
                location_name: next.name,
                location_lat: next.lat ?? "",
                location_lng: next.lng ?? "",
                location_place_id: next.place_id ?? "",
              })
            }
          />
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className={label}>Party size (optional)</span>
              <input
                type="number"
                min={1}
                step={1}
                className={field}
                value={str("guests")}
                onChange={(e) => set("guests", e.target.value)}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={label}>Cuisine (optional)</span>
              <select className={field} value={str("cuisine")} onChange={(e) => set("cuisine", e.target.value)}>
                <option value="">Select a cuisine</option>
                {CUISINE_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.cuisines.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={label}>
              Price range <span className="text-red-500">*</span>
            </span>
            <div className="flex gap-1.5">
              {PRICING_TIERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("price_tier", t)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    str("price_tier") === t ? "border-transparent bg-foreground text-background" : pillInactive
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </label>
          <input
            type="url"
            className={field}
            placeholder="Reservation link (required) — e.g. OpenTable or the restaurant's page"
            required
            value={str("booking_link")}
            onChange={(e) => set("booking_link", e.target.value)}
          />
        </div>
      );
    }
  }
}

const ACCOMMODATION_FIELD_KIND: Record<AccommodationFieldKey, "number" | "yesno" | "select"> = {
  rooms: "number",
  guests: "number",
  breakfast: "yesno",
  bedrooms: "number",
  beds: "number",
  bathrooms: "number",
  max_guests: "number",
  room_type_private_dorm: "select",
  num_beds: "number",
  unit_type: "select",
  room_type_private_shared: "select",
  bedding_provided: "yesno",
  sleeping_capacity: "number",
  num_vehicles: "number",
  berths: "number",
  num_sites: "number",
};

const ACCOMMODATION_FIELD_SELECT_OPTIONS: Partial<Record<AccommodationFieldKey, string[]>> = {
  room_type_private_dorm: ["Private room", "Dorm bed"],
  room_type_private_shared: ["Private", "Shared"],
  unit_type: ["Tent", "Yurt", "Treehouse", "Cabin", "Dome", "Other"],
};

function AccommodationField({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: AccommodationFieldKey;
  value: string;
  onChange: (v: string) => void;
}) {
  const kind = ACCOMMODATION_FIELD_KIND[fieldKey];
  return (
    <label className="flex flex-col gap-1">
      <span className={label}>{ACCOMMODATION_FIELD_LABELS[fieldKey]}</span>
      {kind === "number" ? (
        <input
          type="number"
          min={0}
          step={1}
          className={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : kind === "yesno" ? (
        <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : (
        <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(ACCOMMODATION_FIELD_SELECT_OPTIONS[fieldKey] ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

function DatesFields({
  value,
  onChange,
  required = true,
  allowNights = true,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  required?: boolean;
  // Accommodations' check-in/check-out are always real calendar dates — you
  // can't book a hotel for "7 nights, date TBD" the way a trip-level Dates
  // element can stay open before it locks. false hides the Nights mode
  // entirely and forces Exact dates, rather than letting a check-in/out
  // pair be submitted with no actual dates in it.
  allowNights?: boolean;
}) {
  const str = (k: string) => String(value[k] ?? "");
  // UI-only: which entry mode is active. Seeded from whatever's already in
  // the value so re-opening a partially-filled option lands in the right
  // mode. The two modes are independent, not derived from each other —
  // Nights means "we know the length, not yet when" (no start date at all,
  // suggesting one would be misleading); Exact dates means real anchored
  // dates.
  const [mode, setMode] = useState<"exact" | "nights">(allowNights && str("nights") ? "nights" : "exact");

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
      {allowNights && (
        <ModeToggle
          value={mode}
          onChange={switchMode}
          options={[
            { value: "exact", label: "Exact dates" },
            { value: "nights", label: "Nights" },
          ]}
        />
      )}

      {mode === "exact" || !allowNights ? (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>
              Start date {required && <span className="text-red-500">*</span>}
            </span>
            <input
              type="date"
              required={required}
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
              End date {required && <span className="text-red-500">*</span>}
            </span>
            <input
              type="date"
              required={required}
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
  optional = false,
  onChangePrice,
  onChangeCurrency,
  onChangePricingBasis,
}: {
  price: string;
  currency: string;
  pricingBasis: string;
  optional?: boolean;
  onChangePrice: (v: string) => void;
  onChangeCurrency: (v: string) => void;
  onChangePricingBasis: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={label}>
            {optional ? "Estimated price (optional)" : (
              <>
                Price <span className="text-red-500">*</span>
              </>
            )}
          </span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            required={!optional}
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
