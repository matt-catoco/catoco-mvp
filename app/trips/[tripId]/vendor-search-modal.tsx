"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TRAVEL_SEARCH_MODES,
  TRAVEL_MODE_LABELS,
  ACCOMMODATION_SEARCH_SUBTYPES,
  ACCOMMODATION_SEARCH_SUBTYPE_LABELS,
  EXPERIENCE_SEARCH_SUBTYPES,
  EXPERIENCE_SEARCH_SUBTYPE_LABELS,
  formatCurrency,
  type ElementType,
  type TravelMode,
  type AccommodationSearchSubtype,
  type ExperienceSearchSubtype,
  type TravelersBreakdown,
  type TripContext,
} from "@/lib/trip-elements";
import { fieldClass, labelClass, pillActiveTeal, pillInactive, btnPrimary, btnSecondary } from "@/lib/ui";
import type { VendorSearchParams, VendorSearchResult, VendorSearchResponse } from "@/lib/vendor-search/types";
import { vendorResultToOptionValue } from "@/lib/vendor-search/to-option-value";
import { submitOption } from "./actions";

const field = `h-10 ${fieldClass}`;

type SearchSubtype = TravelMode | AccommodationSearchSubtype | ExperienceSearchSubtype | "";

function TravelersField({
  value,
  onChange,
}: {
  value: TravelersBreakdown;
  onChange: (next: TravelersBreakdown) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={labelClass}>Travelers</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-brand-muted">Adults</span>
        <input
          type="number"
          min={1}
          className={`${field} w-20`}
          value={value.adults}
          onChange={(e) => onChange({ ...value, adults: Math.max(1, Number(e.target.value) || 1) })}
        />
      </div>
      {(value.children_ages ?? []).map((age, i) => (
        <div key={`child-${i}`} className="flex items-center gap-2">
          <span className="text-xs text-brand-muted">Child {i + 1} age</span>
          <input
            type="number"
            min={0}
            max={17}
            className={`${field} w-20`}
            value={age}
            onChange={(e) => {
              const next = [...(value.children_ages ?? [])];
              next[i] = Number(e.target.value) || 0;
              onChange({ ...value, children_ages: next });
            }}
          />
          <button
            type="button"
            className="text-xs text-brand-muted underline"
            onClick={() => {
              const next = (value.children_ages ?? []).filter((_, idx) => idx !== i);
              onChange({ ...value, children_ages: next });
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {(value.infants_ages ?? []).map((age, i) => (
        <div key={`infant-${i}`} className="flex items-center gap-2">
          <span className="text-xs text-brand-muted">Infant {i + 1} age (months)</span>
          <input
            type="number"
            min={0}
            max={23}
            className={`${field} w-20`}
            value={age}
            onChange={(e) => {
              const next = [...(value.infants_ages ?? [])];
              next[i] = Number(e.target.value) || 0;
              onChange({ ...value, infants_ages: next });
            }}
          />
          <button
            type="button"
            className="text-xs text-brand-muted underline"
            onClick={() => {
              const next = (value.infants_ages ?? []).filter((_, idx) => idx !== i);
              onChange({ ...value, infants_ages: next });
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          type="button"
          className="text-xs text-brand-teal-deep underline"
          onClick={() => onChange({ ...value, children_ages: [...(value.children_ages ?? []), 8] })}
        >
          + Add child
        </button>
        <button
          type="button"
          className="text-xs text-brand-teal-deep underline"
          onClick={() => onChange({ ...value, infants_ages: [...(value.infants_ages ?? []), 1] })}
        >
          + Add infant
        </button>
      </div>
    </div>
  );
}

function PillRow<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === o ? pillActiveTeal : pillInactive
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/**
 * Search-on-submit (not live-as-you-type — these are real, likely
 * rate-limited/cost-per-call vendor APIs) overlay for Travel/Accommodations/
 * Experiences/Dining's "propose an option" step. Selecting a result submits
 * it directly (no review/pre-fill step — founder's call) via the same
 * submitOption() the manual form uses, so it lands identically either way.
 * Destination isn't here — it already has its own Mapbox-backed inline
 * autocomplete (PlacePicker), this modal doesn't duplicate that.
 */
export function VendorSearchModal({
  elementId,
  elementType,
  tripContext,
  onClose,
}: {
  elementId: string;
  elementType: ElementType;
  tripContext?: TripContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const [subtype, setSubtype] = useState<SearchSubtype>(() => {
    if (elementType === "travel") return "flight";
    if (elementType === "accommodation") return "hotel";
    if (elementType === "experience") return "tours";
    return "";
  });
  const [location, setLocation] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("");
  const [partySize, setPartySize] = useState(tripContext?.travelers?.adults ?? 2);
  const [travelers, setTravelers] = useState<TravelersBreakdown>(
    () => tripContext?.travelers ?? { adults: 1 },
  );
  const [vehicleType, setVehicleType] = useState("Economy");
  const [transmission, setTransmission] = useState<"automatic" | "manual">("automatic");
  const [roundTrip, setRoundTrip] = useState(true);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [response, setResponse] = useState<VendorSearchResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buildParams(): VendorSearchParams {
    return {
      elementType,
      searchSubtype: subtype,
      location: location || undefined,
      destination: destination || undefined,
      startDate: startDate || undefined,
      endDate: subtype !== "rental_car" && !roundTrip ? undefined : endDate || undefined,
      time: time || undefined,
      partySize: elementType === "dining" ? partySize : undefined,
      travelers: elementType === "travel" && subtype === "flight" ? travelers : elementType === "accommodation" ? travelers : undefined,
      vehicleType: subtype === "rental_car" ? vehicleType : undefined,
      transmission: subtype === "rental_car" ? transmission : undefined,
    };
  }

  // The Search button isn't inside a <form>, so native `required` attrs
  // don't block anything on their own -- this is the actual gate.
  function validateSearch(): string | null {
    if (elementType === "travel") {
      if (subtype === "rental_car") {
        if (!location.trim()) return "Enter a pickup location";
        if (!startDate) return "Pick a pickup date";
        if (!endDate) return "Pick a drop-off date";
      } else {
        if (!startDate) return "Pick a travel date";
        if (roundTrip && !endDate) return "Pick a return date";
      }
    }
    if (elementType === "accommodation") {
      if (!startDate) return "Pick a check-in date";
      if (!endDate) return "Pick a check-out date";
    }
    return null;
  }

  async function search() {
    const err = validateSearch();
    if (err) {
      setFieldError(err);
      return;
    }
    setFieldError(null);
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/vendor-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildParams()),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error ?? "Search failed");
        setStatus("error");
        return;
      }
      setResponse(data as VendorSearchResponse);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Search failed");
      setStatus("error");
    }
  }

  function selectResult(result: VendorSearchResult) {
    setSubmitError(null);
    startTransition(async () => {
      const value = vendorResultToOptionValue(elementType, buildParams(), result);
      const res = await submitOption(elementId, value);
      if (res.error) {
        setSubmitError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const subtypePills =
    elementType === "travel" ? (
      <PillRow value={subtype as TravelMode} options={TRAVEL_SEARCH_MODES} labels={TRAVEL_MODE_LABELS} onChange={(v) => setSubtype(v)} />
    ) : elementType === "accommodation" ? (
      <PillRow
        value={subtype as AccommodationSearchSubtype}
        options={ACCOMMODATION_SEARCH_SUBTYPES}
        labels={ACCOMMODATION_SEARCH_SUBTYPE_LABELS}
        onChange={(v) => setSubtype(v)}
      />
    ) : elementType === "experience" ? (
      <PillRow
        value={subtype as ExperienceSearchSubtype}
        options={EXPERIENCE_SEARCH_SUBTYPES}
        labels={EXPERIENCE_SEARCH_SUBTYPE_LABELS}
        onChange={(v) => setSubtype(v)}
      />
    ) : null;

  const searchFields = (() => {
    if (elementType === "travel") {
      if (subtype === "rental_car") {
        return (
          <>
            <input className={field} placeholder="Pickup location" value={location} onChange={(e) => setLocation(e.target.value)} />
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelClass}>
                  Pickup <span className="text-red-500">*</span>
                </span>
                <input type="date" required className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelClass}>
                  Drop-off <span className="text-red-500">*</span>
                </span>
                <input type="date" required className={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
            <div className="flex gap-3">
              <input className={field} placeholder="Vehicle type" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} />
              <PillRow
                value={transmission}
                options={["automatic", "manual"] as const}
                labels={{ automatic: "Automatic", manual: "Manual" }}
                onChange={setTransmission}
              />
            </div>
          </>
        );
      }
      return (
        <>
          <div className="flex gap-3">
            <input className={field} placeholder="From" value={location} onChange={(e) => setLocation(e.target.value)} />
            <input className={field} placeholder="To" value={destination} onChange={(e) => setDestination(e.target.value)} />
          </div>
          <PillRow
            value={roundTrip ? "round_trip" : "one_way"}
            options={["round_trip", "one_way"] as const}
            labels={{ round_trip: "Round trip", one_way: "One-way" }}
            onChange={(v) => setRoundTrip(v === "round_trip")}
          />
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>
                {subtype === "flight" ? "Depart" : "Travel date"} <span className="text-red-500">*</span>
              </span>
              <input type="date" required className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            {roundTrip && (
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelClass}>
                  Return <span className="text-red-500">*</span>
                </span>
                <input
                  type="date"
                  required
                  className={field}
                  min={startDate || undefined}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            )}
          </div>
          {subtype === "flight" && <TravelersField value={travelers} onChange={setTravelers} />}
        </>
      );
    }
    if (elementType === "accommodation") {
      return (
        <>
          <input className={field} placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>
                Check-in <span className="text-red-500">*</span>
              </span>
              <input type="date" required className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>
                Check-out <span className="text-red-500">*</span>
              </span>
              <input
                type="date"
                required
                className={field}
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          <TravelersField value={travelers} onChange={setTravelers} />
        </>
      );
    }
    if (elementType === "experience") {
      return (
        <>
          <input className={field} placeholder="Destination" value={location} onChange={(e) => setLocation(e.target.value)} />
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Date</span>
            <input type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        </>
      );
    }
    // dining
    return (
      <>
        <input className={field} placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Date</span>
            <input type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Time</span>
            <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="flex w-24 flex-col gap-1">
            <span className={labelClass}>Party</span>
            <input
              type="number"
              min={1}
              className={field}
              value={partySize}
              onChange={(e) => setPartySize(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>
      </>
    );
  })();

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      {/* mx-auto + fixed margin, not flex items-center — see add-element-modal.tsx's
          comment for why that combination clips overflowing content off-screen. */}
      <div
        className="mx-auto my-8 flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-brand-line bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">Search options</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-brand-muted transition-colors hover:bg-brand-teal-wash hover:text-brand-teal-deep"
          >
            ✕
          </button>
        </div>
        {response && (
          <span className="mb-3 inline-block w-fit rounded-full bg-brand-teal-wash px-2.5 py-0.5 text-[11px] font-medium text-brand-teal-deep">
            {response.status === "live" ? `Live via ${response.vendorLabel}` : response.vendorLabel}
          </span>
        )}

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {subtypePills}
          {searchFields}

          <button
            type="button"
            onClick={search}
            disabled={status === "loading"}
            className={`self-start px-4 py-2 text-sm ${btnPrimary}`}
          >
            {status === "loading" ? "Searching…" : "Search"}
          </button>

          {fieldError && <p className="text-xs text-red-500">{fieldError}</p>}

          {status === "error" && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {errorMessage ?? "Something went wrong reaching this vendor. Try again in a moment."}
            </p>
          )}

          {status === "done" && response && (
            <div className="flex flex-col gap-2 border-t border-brand-line pt-3">
              {response.results.length === 0 ? (
                <p className="rounded-lg bg-black/[.03] px-3 py-2 text-xs text-zinc-500 dark:bg-white/[.05]">
                  No results for this search — try different dates, a different location, or broaden the search.
                </p>
              ) : (
                response.results.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-brand-line p-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.title}</p>
                      {r.description && <p className="truncate text-xs text-brand-muted">{r.description}</p>}
                      {r.price !== undefined && (
                        <p className="text-xs text-brand-muted">{formatCurrency(r.price, r.currency ?? "USD")}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => selectResult(r)}
                      className={`shrink-0 px-3 py-1.5 text-xs ${btnSecondary}`}
                    >
                      {pending ? "Adding…" : "Select"}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
          {submitError && <p className="text-xs text-red-500">{submitError}</p>}
        </div>
      </div>
    </div>
  );
}
