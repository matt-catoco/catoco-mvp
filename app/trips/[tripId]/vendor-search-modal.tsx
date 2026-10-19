"use client";

import { useState } from "react";
import {
  TRAVEL_SEARCH_MODES,
  TRAVEL_MODE_LABELS,
  ACCOMMODATION_SEARCH_SUBTYPES,
  ACCOMMODATION_SEARCH_SUBTYPE_LABELS,
  priceLabel,
  type ElementType,
  type TravelMode,
  type AccommodationSearchSubtype,
  type ExperienceSearchSubtype,
  type TravelersBreakdown,
  type TripContext,
  DINING_TIME_SLOTS,
} from "@/lib/trip-elements";
import { fieldClass, labelClass, pillActiveTeal, pillInactive, btnPrimary, btnSecondary } from "@/lib/ui";
import type { VendorSearchParams, VendorSearchResult, VendorSearchResponse } from "@/lib/vendor-search/types";
import { vendorResultToOptionValue } from "@/lib/vendor-search/to-option-value";
import { DateRangeField } from "@/components/date-range-field";
import { AirportPicker } from "@/components/airport-picker";
import { NumberInput } from "@/components/number-input";

const field = `h-10 ${fieldClass}`;

type SearchSubtype = TravelMode | AccommodationSearchSubtype | ExperienceSearchSubtype | "";

// Every element type this panel actually knows how to search — Destination
// already has its own live Mapbox autocomplete (PlacePicker) and Dates
// isn't price-bearing, so neither goes through vendor search at all.
export const VENDOR_SEARCHABLE_TYPES: ElementType[] = ["travel", "accommodation", "experience", "dining"];

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
        <NumberInput
          integer
          min={1}
          className={`${field} w-20`}
          value={value.adults}
          onValueChange={(n) => onChange({ ...value, adults: Math.max(1, n) })}
        />
      </div>
      {(value.children_ages ?? []).map((age, i) => (
        <div key={`child-${i}`} className="flex items-center gap-2">
          <span className="text-xs text-brand-muted">Child {i + 1} age</span>
          <NumberInput
            integer
            min={0}
            max={17}
            className={`${field} w-20`}
            value={age}
            onValueChange={(n) => {
              const next = [...(value.children_ages ?? [])];
              next[i] = Math.min(17, Math.max(0, n));
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
          <NumberInput
            integer
            min={0}
            max={23}
            className={`${field} w-20`}
            value={age}
            onValueChange={(n) => {
              const next = [...(value.infants_ages ?? [])];
              next[i] = Math.min(23, Math.max(0, n));
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
 * The actual search UI — fields, Search button, results list — with no
 * modal chrome of its own and no opinion on what happens when a result is
 * picked. Shared by two callers with different "what happens on select"
 * needs: VendorSearchModal (below) submits directly to an already-created
 * open element and closes; AddElementForm renders this in place of the
 * manual Value form when locking a searchable type in at creation, and
 * treats a pick as the locked value for that create_element() call.
 */
// ---- Flight result filters (founder, 2026-10-20) -------------------------------
// Display-only narrowing of one search's results, using the structured
// details Duffel returns (result.flight). Nothing is re-fetched.

type TimeWindow = "any" | "early" | "morning" | "afternoon" | "evening";
const TIME_WINDOWS: { key: TimeWindow; label: string; from: number; to: number }[] = [
  { key: "any", label: "Any time", from: 0, to: 24 },
  { key: "early", label: "Before 6am", from: 0, to: 6 },
  { key: "morning", label: "Morning", from: 6, to: 12 },
  { key: "afternoon", label: "Afternoon", from: 12, to: 18 },
  { key: "evening", label: "Evening", from: 18, to: 24 },
];
const inWindow = (hhmm: string, w: TimeWindow) => {
  if (w === "any" || !hhmm) return true;
  const h = Number(hhmm.slice(0, 2));
  const win = TIME_WINDOWS.find((t) => t.key === w)!;
  return h >= win.from && h < win.to;
};
type FlightFilter = {
  stops: "any" | "0" | "1";
  airlines: string[];
  depart: TimeWindow;
  arrive: TimeWindow;
  sort: "price" | "duration" | "depart";
};
const NO_FLIGHT_FILTER: FlightFilter = { stops: "any", airlines: [], depart: "any", arrive: "any", sort: "price" };

function applyFlightFilter(results: VendorSearchResult[], f: FlightFilter): VendorSearchResult[] {
  const legsOk = (r: VendorSearchResult) => {
    const legs = [r.flight!.outbound, ...(r.flight!.inbound ? [r.flight!.inbound] : [])];
    return f.stops === "any" || legs.every((l) => l.stops <= Number(f.stops));
  };
  const out = results.filter(
    (r) =>
      !r.flight ||
      (legsOk(r) &&
        (f.airlines.length === 0 || f.airlines.includes(r.flight.airline)) &&
        inWindow(r.flight.outbound.depart, f.depart) &&
        inWindow(r.flight.outbound.arrive, f.arrive)),
  );
  const total = (r: VendorSearchResult) =>
    (r.flight?.outbound.durationMinutes ?? 9e9) + (r.flight?.inbound?.durationMinutes ?? 0);
  return out.sort((a, b) =>
    f.sort === "duration"
      ? total(a) - total(b)
      : f.sort === "depart"
        ? (a.flight?.outbound.depart ?? "99").localeCompare(b.flight?.outbound.depart ?? "99")
        : (a.price ?? 0) - (b.price ?? 0),
  );
}

function FlightFilters({
  results,
  value,
  onChange,
}: {
  results: VendorSearchResult[];
  value: FlightFilter;
  onChange: (f: FlightFilter) => void;
}) {
  // Airlines with their lowest price, cheapest first.
  const airlines = new Map<string, number>();
  for (const r of results) {
    if (!r.flight) continue;
    const prev = airlines.get(r.flight.airline);
    if (prev === undefined || (r.price ?? 0) < prev) airlines.set(r.flight.airline, r.price ?? 0);
  }
  const currency = results.find((r) => r.currency)?.currency ?? "USD";
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
      on ? "border-brand-accent bg-brand-teal-wash text-brand-accent" : "border-brand-line text-brand-muted hover:text-foreground"
    }`;
  const row = "flex flex-wrap items-center gap-1.5";
  const label = "w-16 flex-none text-[11px] font-semibold text-brand-muted";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-line p-2.5" role="group" aria-label="Filter flights">
      <div className={row}>
        <span className={label}>Stops</span>
        {(
          [
            ["any", "Any"],
            ["0", "Nonstop"],
            ["1", "1 stop or fewer"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={value.stops === k} onClick={() => onChange({ ...value, stops: k })} className={chip(value.stops === k)}>
            {l}
          </button>
        ))}
      </div>
      {airlines.size > 1 && (
        <div className={row}>
          <span className={label}>Airlines</span>
          {[...airlines.entries()]
            .sort((a, b) => a[1] - b[1])
            .map(([name, from]) => {
              const on = value.airlines.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange({ ...value, airlines: on ? value.airlines.filter((a) => a !== name) : [...value.airlines, name] })
                  }
                  className={chip(on)}
                >
                  {name} · {priceLabel({ price: from, currency, pricing_basis: "", mode: "flight" })}
                </button>
              );
            })}
        </div>
      )}
      {(["depart", "arrive"] as const).map((k) => (
        <div key={k} className={row}>
          <span className={label}>{k === "depart" ? "Departs" : "Arrives"}</span>
          {TIME_WINDOWS.map((w) => (
            <button key={w.key} type="button" aria-pressed={value[k] === w.key} onClick={() => onChange({ ...value, [k]: w.key })} className={chip(value[k] === w.key)}>
              {w.label}
            </button>
          ))}
        </div>
      ))}
      <div className={row}>
        <span className={label}>Sort</span>
        {(
          [
            ["price", "Cheapest"],
            ["duration", "Fastest"],
            ["depart", "Earliest"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={value.sort === k} onClick={() => onChange({ ...value, sort: k })} className={chip(value.sort === k)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VendorSearchPanel({
  elementType,
  tripContext,
  onSelect,
  selecting = false,
}: {
  elementType: ElementType;
  tripContext?: TripContext;
  onSelect: (value: Record<string, unknown>) => void;
  selecting?: boolean;
}) {
  const [subtype, setSubtype] = useState<SearchSubtype>(() => {
    if (elementType === "travel") return "flight";
    if (elementType === "accommodation") return "hotel";
    return "";
  });
  const [keyword, setKeyword] = useState("");
  // Experiences start from the trip's locked destination — overridable.
  const [location, setLocation] = useState(() =>
    elementType === "experience" ? (tripContext?.destination?.name ?? "") : "",
  );
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
  const [flightFilter, setFlightFilter] = useState<FlightFilter>(NO_FLIGHT_FILTER);
  const [shownCount, setShownCount] = useState(20);

  function buildParams(): VendorSearchParams {
    return {
      elementType,
      searchSubtype: subtype,
      keyword: elementType === "experience" ? keyword.trim() || undefined : undefined,
      location: location || undefined,
      destination: destination || undefined,
      startDate: startDate || undefined,
      endDate: subtype !== "rental_car" && !roundTrip ? undefined : endDate || undefined,
      time: time || undefined,
      partySize: elementType === "dining" ? partySize : undefined,
      travelers:
        (elementType === "travel" && (subtype === "flight" || subtype === "transfer")) ||
        elementType === "accommodation" ||
        elementType === "experience"
          ? travelers
          : undefined,
      vehicleType: subtype === "rental_car" ? vehicleType : undefined,
      transmission: subtype === "rental_car" ? transmission : undefined,
    };
  }

  // The Search button isn't inside a <form>, so native `required` attrs
  // don't block anything on their own -- this is the actual gate.
  function validateSearch(): string | null {
    if (elementType === "travel") {
      if (subtype === "transfer") {
        if (!location.trim()) return "Pick the airport you're arriving at";
        if (!destination.trim()) return "Enter the hotel or address";
        if (!startDate) return "Pick the transfer date";
        if (roundTrip && !endDate) return "Pick the return date";
        return null;
      }
      if (subtype === "rental_car") {
        if (!location.trim()) return "Enter a pickup location";
        if (!startDate) return "Pick a pickup date";
        if (!endDate) return "Pick a drop-off date";
      } else {
        if (!startDate) return "Pick a travel date";
        if (roundTrip && !endDate) return "Pick a return date";
      }
    }
    if (elementType === "experience" && !keyword.trim() && !location.trim()) {
      return "Enter what you're looking for or where";
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
      setFlightFilter(NO_FLIGHT_FILTER);
      setShownCount(20);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Search failed");
      setStatus("error");
    }
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
    ) : null;

  const searchFields = (() => {
    if (elementType === "travel") {
      if (subtype === "rental_car") {
        return (
          <>
            <input className={field} placeholder="Pickup location" value={location} onChange={(e) => setLocation(e.target.value)} />
            <DateRangeField
              startLabel="Pickup"
              endLabel="Drop-off"
              required
              startDate={startDate}
              endDate={endDate}
              onChange={(s, e) => {
                setStartDate(s);
                setEndDate(e);
              }}
            />
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
      if (subtype === "transfer") {
        return (
          <>
            {/* Stacked and labelled: side by side, the airport picker got squeezed to nothing. */}
            <div key="transfer-places" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className={labelClass}>Pickup — arrival airport</span>
                <div className="flex">
                  <AirportPicker placeholder="Airport or city, e.g. SVQ or Sevilla" value={location} onChange={setLocation} />
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Drop-off — hotel or address</span>
                <input
                  className={field}
                  placeholder="Hotel name or street address"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </label>
            </div>
            <PillRow
              value={roundTrip ? "round_trip" : "one_way"}
              options={["round_trip", "one_way"] as const}
              labels={{ round_trip: "Return too", one_way: "One-way" }}
              onChange={(v) => setRoundTrip(v === "round_trip")}
            />
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <DateRangeField
                  startLabel="Transfer date"
                  endLabel="Return"
                  required
                  single={!roundTrip}
                  startDate={startDate}
                  endDate={endDate}
                  onChange={(s, e) => {
                    setStartDate(s);
                    setEndDate(e);
                  }}
                />
              </div>
              <label className="flex w-32 flex-none flex-col gap-1">
                <span className={labelClass}>Arrival time</span>
                <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <TravelersField value={travelers} onChange={setTravelers} />
          </>
        );
      }
      return (
        <>
          {subtype === "flight" ? (
            // key: a fresh picker per subtype switch, so its display text
            // never drifts from the parent's value.
            <div key="flight-places" className="flex gap-3">
              <AirportPicker placeholder="From — city or airport" value={location} onChange={setLocation} />
              <AirportPicker placeholder="To — city or airport" value={destination} onChange={setDestination} />
            </div>
          ) : (
            <div className="flex gap-3">
              <input className={field} placeholder="From" value={location} onChange={(e) => setLocation(e.target.value)} />
              <input className={field} placeholder="To" value={destination} onChange={(e) => setDestination(e.target.value)} />
            </div>
          )}
          <PillRow
            value={roundTrip ? "round_trip" : "one_way"}
            options={["round_trip", "one_way"] as const}
            labels={{ round_trip: "Round trip", one_way: "One-way" }}
            onChange={(v) => setRoundTrip(v === "round_trip")}
          />
          <DateRangeField
            startLabel={subtype === "flight" ? "Depart" : "Travel date"}
            endLabel="Return"
            required
            single={!roundTrip}
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => {
              setStartDate(s);
              setEndDate(e);
            }}
          />
          {subtype === "flight" && <TravelersField value={travelers} onChange={setTravelers} />}
        </>
      );
    }
    if (elementType === "accommodation") {
      return (
        <>
          <input className={field} placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <DateRangeField
            startLabel="Check-in"
            endLabel="Check-out"
            required
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => {
              setStartDate(s);
              setEndDate(e);
            }}
          />
          <TravelersField value={travelers} onChange={setTravelers} />
        </>
      );
    }
    if (elementType === "experience") {
      return (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>What</span>
            <input
              className={field}
              placeholder="e.g. ghost tour, cooking class, concert"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Where</span>
            <input className={field} placeholder="City or area" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Date</span>
            <input type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {/* No Time field here — Viator's free-text search has no time
              filter (a searched time wouldn't affect results at all), and
              stamping it onto whichever candidate gets picked would overstate
              certainty search results shouldn't carry: a specific start time
              only makes sense once an option is actually voted in, not at
              search time (see viator.ts's duration-not-a-time note). Date
              stays — which day is still a meaningful, real filter signal. */}
          {/* Party size wasn't collected here at all before — a real gap for
              a type where price/availability genuinely depends on group
              size. Collected and carried onto the locked option's value
              (vendorResultToOptionValue's `...extra` spread) either way;
              see viator.ts's own note on why it can't affect Viator's
              free-text search results themselves yet. */}
          <TravelersField value={travelers} onChange={setTravelers} />
        </>
      );
    }
    // dining
    return (
      <>
        <input className={field} placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={labelClass}>Date</span>
            <input type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={labelClass}>Time</span>
            <select
                className={field}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              >
                <option value="">Any time</option>
                {/* A pre-slot value (free entry used to allow any minute) stays selectable. */}
                {time && !DINING_TIME_SLOTS.some((s) => s.value === time) && (
                  <option value={time}>{time}</option>
                )}
                {DINING_TIME_SLOTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
          </label>
          <label className="flex w-24 flex-col gap-1">
            <span className={labelClass}>Party</span>
            <NumberInput
              integer
              min={1}
              className={field}
              value={partySize}
              onValueChange={(n) => setPartySize(Math.max(1, n))}
            />
          </label>
        </div>
      </>
    );
  })();

  const isFlightResults = subtype === "flight" && Boolean(response?.results.some((r) => r.flight));
  const filtered = response ? (isFlightResults ? applyFlightFilter(response.results, flightFilter) : response.results) : [];

  return (
    <div className="flex flex-col gap-3">
      {response && (
        <span className="inline-block w-fit rounded-full bg-brand-teal-wash px-2.5 py-0.5 text-[11px] font-medium text-brand-accent">
          {response.status === "live" ? `Live via ${response.vendorLabel}` : response.vendorLabel}
        </span>
      )}

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
              {response.notice ?? "No results for this search — try different dates, a different location, or broaden the search."}
            </p>
          ) : (
            <>
            {isFlightResults && (
              <>
                <FlightFilters results={response.results} value={flightFilter} onChange={(f) => { setFlightFilter(f); setShownCount(20); }} />
                <p className="text-[11px] text-brand-muted" role="status">
                  {filtered.length === response.results.length
                    ? `${filtered.length} flights`
                    : `${filtered.length} of ${response.results.length} flights`}
                </p>
              </>
            )}
            <p className="text-[11px] text-brand-muted">
              Prices are live quotes, not guaranteed until booked — they can move before the group pays
              (covered up to the trip&apos;s price cushion).
            </p>
            {isFlightResults && filtered.length === 0 && (
              <p className="rounded-lg bg-black/[.03] px-3 py-2 text-xs text-zinc-500 dark:bg-white/[.05]">
                No flights match these filters.{" "}
                <button type="button" className="underline" onClick={() => setFlightFilter(NO_FLIGHT_FILTER)}>
                  Clear filters
                </button>
              </p>
            )}
            {filtered.slice(0, shownCount).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-brand-line p-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.title}</p>
                  {r.description && <p className="truncate text-xs text-brand-muted">{r.description}</p>}
                  {r.price !== undefined && (
                    // "From" — a search result's price is indicative, not a
                    // lock: what actually gets submitted (and later funded)
                    // can differ once someone checks real availability, so
                    // this shouldn't read as a firm quote.
                    <p className="text-xs text-brand-muted">
                      {r.source && <span className="mr-1.5 rounded-full border border-brand-line px-1.5 py-px text-[10px]">via {r.source}</span>}
                      From {priceLabel({ price: r.price, currency: r.currency, pricing_basis: r.pricing_basis, mode: subtype })}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={selecting}
                  onClick={() => onSelect(vendorResultToOptionValue(elementType, buildParams(), r))}
                  className={`shrink-0 px-3 py-1.5 text-xs ${btnSecondary}`}
                >
                  {selecting ? "Adding…" : "Select"}
                </button>
              </div>
            ))}
            {filtered.length > shownCount && (
              <button
                type="button"
                onClick={() => setShownCount((n) => n + 20)}
                className={`self-center px-3 py-1.5 text-xs ${btnSecondary}`}
              >
                Show more ({filtered.length - shownCount} more)
              </button>
            )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Modal chrome around VendorSearchPanel for the post-creation "Search
 * options" flow. Pure search-and-pick: the chosen result goes back to
 * SubmitOptionForm (onPicked) for a review step with a note before it's
 * added (founder redesign, 2026-10-14 — reverses the earlier "submit
 * directly, no review" call). Search itself is unchanged.
 */
export function VendorSearchModal({
  elementType,
  tripContext,
  onClose,
  onPicked,
}: {
  elementType: ElementType;
  tripContext?: TripContext;
  onClose: () => void;
  onPicked: (value: Record<string, unknown>) => void;
}) {
  function handleSelect(value: Record<string, unknown>) {
    onPicked(value);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm sm:p-4" onClick={onClose}>
      {/* mx-auto + fixed margin, not flex items-center — see add-element-modal.tsx's
          comment for why that combination clips overflowing content off-screen.
          Full-screen below sm: a real results list plus the traveler-breakdown
          fields gets cramped fast in a small centered card once both are on
          screen together — this is the one modal in the app dense enough to
          need it. */}
      <div
        className="mx-auto flex h-full w-full max-w-xl flex-col border border-brand-line bg-background p-6 shadow-lg sm:my-8 sm:h-auto sm:max-h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">Search options</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-brand-muted transition-colors hover:bg-brand-teal-wash hover:text-brand-accent"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto pr-1">
          <VendorSearchPanel elementType={elementType} tripContext={tripContext} onSelect={handleSelect} selecting={false} />
        </div>
      </div>
    </div>
  );
}
