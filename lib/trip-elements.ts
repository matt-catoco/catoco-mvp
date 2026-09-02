// Shared element metadata + value-shape validation.
//
// Elements are multi-instance and participant-created (flow #3 redesign,
// 2026-09-01) — there's no more fixed macro/micro slot list, no SQL-side
// value-shape mirror (lib/trip-elements.ts is now the sole validator), and
// Budget/Participants are no longer element types (budget folded into the
// existing optional `price` field on cost-bearing types; Participants is
// its own roster/invite surface, not an element at all).

export const ELEMENT_TYPES = [
  "dates",
  "destination",
  "travel",
  "accommodation",
  "experience",
  "dining",
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];
export type ElementState = "locked" | "open";

export const ELEMENT_LABELS: Record<ElementType, string> = {
  dates: "Dates",
  destination: "Destination",
  travel: "Travel",
  accommodation: "Accommodations",
  experience: "Experiences",
  dining: "Dining",
};

export const ELEMENT_BLURBS: Record<ElementType, string> = {
  dates: "When it happens",
  destination: "Where you're going",
  travel: "How you get there",
  accommodation: "Where you stay",
  experience: "Things to do",
  dining: "Where to eat",
};

// Two-letter marks for the tile grid (Trip Home dashboard + homepage demo).
export const ELEMENT_SYMBOLS: Record<ElementType, string> = {
  dates: "Dt",
  destination: "Ds",
  travel: "Tr",
  accommodation: "Ac",
  experience: "Ex",
  dining: "Dn",
};

// ---- element-level metadata (flexible, per type, TS-only) -----------------
// Freeform jsonb on trip_elements.metadata — no SQL-side shape enforcement,
// so adding/changing a type's fields never needs a migration. This is
// distinct from the option-level `value` shapes below, which describe a
// *candidate* (a specific restaurant/flight/etc. people vote on) — metadata
// describes the element instance itself (e.g. which dining occasion this
// is), set once at creation.

export type MetadataFieldKind = "text" | "date" | "select";
export type MetadataFieldDef = {
  key: string;
  label: string;
  kind: MetadataFieldKind;
  options?: { value: string; label: string }[];
};

export const ELEMENT_METADATA_FIELDS: Record<ElementType, MetadataFieldDef[]> = {
  dates: [],
  destination: [],
  travel: [{ key: "date", label: "Date", kind: "date" }],
  accommodation: [{ key: "date", label: "Date", kind: "date" }],
  experience: [{ key: "date", label: "Date", kind: "date" }],
  dining: [
    { key: "date", label: "Date", kind: "date" },
    {
      key: "meal_type",
      label: "Meal",
      kind: "select",
      options: [
        { value: "breakfast", label: "Breakfast" },
        { value: "lunch", label: "Lunch" },
        { value: "dinner", label: "Dinner" },
      ],
    },
  ],
};

export function emptyMetadataFor(type: ElementType): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ELEMENT_METADATA_FIELDS[type]) out[f.key] = "";
  return out;
}

// ---- Trip Home tile status --------------------------------------------
// One place implementing the real status vocabulary for a single element
// instance. `trip_elements.state` is still just open/locked in the DB —
// this computes a richer *label* from that plus a few other columns.
// There's no "not started" bucket — an element only exists once someone's
// actually created it; nothing to show for types nobody's added yet.
//
// Two label tracks depending on type (confirmed with the founder,
// 2026-09-xx):
//   - Travel/Accommodation/Experience/Dining (PRICE_BEARING_TYPES — the
//     types that actually get a funding_request, per
//     create_funding_request_for_element()'s type exclusion): Open —
//     Submitting -> Open — Voting -> Locked by Organizer or Locked by
//     Group -> Funded -> Booked — ready to go.
//   - Dates/Destination (never priced, never get a funding_request):
//     Open — Submitting -> Open — Voting -> Confirmed -> Booked — ready
//     to go. These two skip the Organizer-vs-Group split and skip Funded
//     entirely — Confirmed is their one milestone between locking and
//     booking, standing in for what Funded means to the other four types.
//     locked_via is still recorded in the DB for every type regardless
//     (cheap, keeps the locking RPCs simple) — the type-based branch that
//     hides it for these two lives here, not in the database.

// A locked element's funding lifecycle (flow #4) — null when it has no
// funding_request at all (Dates/Destination, or an unpriced locked value).
export type FundingStatus = "collecting" | "ready_to_purchase" | "booked" | null;

export type ElementTileInfo = {
  state: ElementState;
  funded: boolean;
  statusLabel: string;
  detail: string;
};

export function describeElementStatus(row: {
  state: ElementState;
  lockedVia: "organizer" | "vote" | null;
  fundingStatus: FundingStatus;
  optionCount: number;
  optionsDeadline: string | null;
  lockedValue: Record<string, unknown> | null;
  type: ElementType;
  // trip_elements.booked_at directly — Dates/Destination (and any unpriced
  // locked value) never get a funding_request at all, so fundingStatus can
  // never read "booked" for them; booked_at is the only signal that works
  // for every type, priced or not.
  bookedAt: string | null;
}): ElementTileInfo {
  if (row.state === "locked") {
    const booked = row.fundingStatus === "booked" || row.bookedAt != null;
    const funded = row.fundingStatus === "ready_to_purchase";
    const statusLabel = booked
      ? "Booked — ready to go"
      : funded
        ? "Funded"
        : !PRICE_BEARING_TYPES.includes(row.type)
          ? "Confirmed"
          : row.lockedVia === "vote"
            ? "Locked by Group"
            : "Locked by Organizer";
    return {
      state: "locked",
      funded: funded || booked,
      statusLabel,
      detail: row.lockedValue ? summarizeOptionValue(row.type, row.lockedValue) : "?",
    };
  }
  const stillSubmitting = !row.optionsDeadline || new Date(row.optionsDeadline) > new Date();
  return {
    state: "open",
    funded: false,
    statusLabel: stillSubmitting ? "Open — Submitting" : "Open — Voting",
    detail:
      row.optionCount > 0
        ? `${row.optionCount} idea${row.optionCount === 1 ? "" : "s"}`
        : "No ideas yet",
  };
}

// ---- option (candidate) value shapes — one per element type ---------------

// Two independent shapes, not a start+derived-end combo: either real
// anchored dates (start_date, optional end_date), or a bare `nights` count
// with no start_date at all — "we need 5 nights, haven't picked when yet."
// Suggesting a start date in the nights case would be misleading (nobody
// proposed one), so the two never coexist — element-value-fields.tsx's
// DatesFields clears one set of fields when you switch modes.
export type DatesValue = {
  start_date?: string;
  end_date?: string;
  nights?: number;
  flexibility_days?: 0 | 1 | 2 | 3;
};
export type DestinationValue = { name: string };
// `price` (optional) is in whatever currency the group is using, manually
// entered by whoever submits the option — the only surviving piece of the
// old Budget element, now per-candidate instead of trip-wide.
// `booking_link` is an MVP stand-in for real inventory — paste an
// Airbnb/hotel/flight/restaurant link. `title`/`description`/`thumbnail_url`
// are auto-extracted server-side from booking_link's Open Graph tags (see
// lib/link-preview.ts) — never set by the user directly.
export type LinkPreview = {
  title?: string;
  description?: string;
  thumbnail_url?: string;
};
export type TravelValue = LinkPreview & {
  mode: string;
  note?: string;
  booking_link?: string;
  price?: number;
  currency?: string;
  pricing_basis?: string;
};
export type PlaceValue = LinkPreview & {
  name: string;
  booking_link?: string;
  price?: number;
  currency?: string;
  pricing_basis?: string;
};

export const PRICE_BEARING_TYPES: ElementType[] = [
  "travel",
  "accommodation",
  "experience",
  "dining",
];

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

// ---- flow #4: pricing basis for real funding-amount calculation -----------
// unit_price/pricing_basis are real columns on element_options (not part of
// the jsonb value like price/currency above) — they drive actual SQL
// arithmetic (required_amount = unit_price * multiplier) once an option
// locks, so they need to be reliably typed. The UI still enters a single
// "price" number; pricing_basis just says what it's a price *per*.
export const PRICING_BASES = ["per_night", "per_person", "flat"] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

export const PRICING_BASIS_LABELS: Record<PricingBasis, string> = {
  per_night: "per night",
  per_person: "per person",
  flat: "flat (shared cost)",
};

export function defaultPricingBasisFor(type: ElementType): PricingBasis {
  return type === "accommodation" ? "per_night" : "per_person";
}

export type OptionValue = DatesValue | DestinationValue | TravelValue | PlaceValue;

export function emptyValueFor(type: ElementType): Record<string, unknown> {
  switch (type) {
    case "dates":
      return {
        start_date: "",
        end_date: "",
        nights: "",
        flexibility_days: "",
      };
    case "destination":
      return { name: "" };
    case "travel":
      return {
        mode: "",
        note: "",
        booking_link: "",
        price: "",
        currency: "USD",
        pricing_basis: defaultPricingBasisFor("travel"),
      };
    default:
      return {
        name: "",
        booking_link: "",
        price: "",
        currency: "USD",
        pricing_basis: defaultPricingBasisFor(type),
      };
  }
}

/** Error message if the optional `price` field is present but not a number >= 0. */
function priceError(value: Record<string, unknown>): string | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "Price must be 0 or more";
  // A price with no pricing_basis can't drive the funding calculation once
  // this option locks — require both together, not price alone.
  const basis = String(value.pricing_basis ?? "").trim();
  if (!basis || !(PRICING_BASES as readonly string[]).includes(basis)) {
    return "Pick what the price is per (night, person, or a flat shared cost)";
  }
  return null;
}

/**
 * Booking link is required on price-bearing types — it's not just a nice-to-
 * have, it's what drives the auto-scraped thumbnail/title/description that
 * make candidates comparable at a glance on the voting page instead of just
 * bare text.
 */
function bookingLinkError(value: Record<string, unknown>): string | null {
  const raw = String(value.booking_link ?? "").trim();
  if (!raw) return "Add a booking link";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    return "Booking link must be a valid http(s) URL";
  }
  return null;
}

/**
 * Returns an error message if `value` is not a valid option for `type`,
 * otherwise null. Accepts loosely-typed draft objects (strings from inputs).
 * TS-only now — there's no SQL-side mirror of this (2026-09-01 redesign).
 */
export function validateOptionValue(
  type: ElementType,
  value: Record<string, unknown> | null | undefined,
): string | null {
  if (!value || typeof value !== "object") return "Missing value";

  const str = (k: string) => String(value[k] ?? "").trim();
  const num = (k: string) => Number(value[k]);

  switch (type) {
    case "dates": {
      if (str("flexibility_days") && !["0", "1", "2", "3"].includes(str("flexibility_days")))
        return "Flexibility must be 0–3 days";
      if (str("nights")) {
        const n = num("nights");
        if (!Number.isInteger(n) || n <= 0) return "Nights must be a whole number above 0";
        return null;
      }
      if (!str("start_date")) return "Pick a start date";
      if (str("end_date") && str("end_date") < str("start_date"))
        return "End date is before the start date";
      return null;
    }
    case "destination":
      return str("name") ? null : "Enter a destination";
    case "travel":
      if (!str("mode")) return "Enter a travel mode";
      return bookingLinkError(value) ?? priceError(value);
    case "accommodation":
    case "experience":
    case "dining":
      if (!str("name")) return "Enter a name";
      return bookingLinkError(value) ?? priceError(value);
    default:
      return "Unknown element type";
  }
}

/**
 * Cross-field check for open elements: options_deadline must be on or before
 * voting_deadline (can't accept new candidates after voting has closed).
 * Mirrors the check in create_element(). Empty strings (unset) are fine.
 */
export function validateDeadlines(
  optionsDeadline: string,
  votingDeadline: string,
): string | null {
  if (optionsDeadline && votingDeadline && optionsDeadline > votingDeadline) {
    return "Submission deadline must be on or before the voting deadline";
  }
  return null;
}

/**
 * Coerce a draft value (input strings) into the typed shape sent to the RPC.
 */
export function normalizeOptionValue(
  type: ElementType,
  value: Record<string, unknown>,
): OptionValue {
  const str = (k: string) => String(value[k] ?? "").trim();
  switch (type) {
    case "dates": {
      // Nights and start/end never coexist — Nights mode means no start date
      // was suggested at all, not "start date, unspecified length."
      const out: DatesValue = {};
      if (str("nights")) {
        out.nights = Number(value.nights);
      } else {
        out.start_date = str("start_date");
        if (str("end_date")) out.end_date = str("end_date");
      }
      if (str("flexibility_days"))
        out.flexibility_days = Number(value.flexibility_days) as 0 | 1 | 2 | 3;
      return out;
    }
    case "destination":
      return { name: str("name") };
    case "travel": {
      const out: TravelValue = { mode: str("mode") };
      if (str("note")) out.note = str("note");
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) {
        out.price = Number(value.price);
        out.currency = str("currency") || "USD";
        out.pricing_basis = str("pricing_basis");
      }
      return out;
    }
    default: {
      const out: PlaceValue = { name: str("name") };
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) {
        out.price = Number(value.price);
        out.currency = str("currency") || "USD";
        out.pricing_basis = str("pricing_basis");
      }
      return out;
    }
  }
}

/**
 * Pulls unit_price/pricing_basis out of a normalized option value for the
 * RPC params that store them as real columns (element_options.unit_price/
 * pricing_basis) — separate from price/currency, which stay in the jsonb
 * value purely for display (OptionSummary). Null/null when no price was set.
 */
export function extractPricing(
  value: Record<string, unknown>,
): { unitPrice: number | null; pricingBasis: PricingBasis | null } {
  const price = value.price;
  if (price === undefined || price === null || String(price).trim() === "") {
    return { unitPrice: null, pricingBasis: null };
  }
  const basis = String(value.pricing_basis ?? "").trim();
  const validBasis = (PRICING_BASES as readonly string[]).includes(basis)
    ? (basis as PricingBasis)
    : null;
  return { unitPrice: Number(price), pricingBasis: validBasis };
}

export function summarizeOptionValue(
  type: ElementType,
  value: Record<string, unknown>,
): string {
  const str = (k: string) => String(value[k] ?? "").trim();
  switch (type) {
    case "dates": {
      const flex = str("flexibility_days");
      let base: string;
      if (str("nights")) {
        base = `${str("nights")} nights`;
      } else {
        base = str("start_date") || "?";
        if (str("end_date")) base += ` → ${str("end_date")}`;
      }
      return flex ? `${base} · ±${flex}d` : base;
    }
    case "travel": {
      const base =
        [str("mode"), str("note"), str("booking_link")].filter(Boolean).join(" — ") || "?";
      return str("price") ? `${base} · ${priceLabel(value)}` : base;
    }
    default: {
      const base = [str("name"), str("booking_link")].filter(Boolean).join(" — ") || "?";
      return str("price") ? `${base} · ${priceLabel(value)}` : base;
    }
  }
}

function priceLabel(value: Record<string, unknown>): string {
  const str = (k: string) => String(value[k] ?? "").trim();
  const basis = str("pricing_basis");
  const suffix =
    basis === "per_night" ? "/night" : basis === "per_person" ? "/person" : "";
  return `${str("currency") || "USD"} ${str("price")}${suffix}`;
}
