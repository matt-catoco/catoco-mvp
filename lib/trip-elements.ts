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
// One place implementing the status vocabulary for a single element
// instance: Collecting ideas (open — including a zero-candidates case,
// worded "No ideas yet" rather than a 0) / Settled (locked). There's no
// "not started" bucket anymore — an element only exists once someone's
// actually created it; nothing to show for types nobody's added yet.

export type ElementTileInfo = {
  state: ElementState;
  statusLabel: string;
  detail: string;
};

export function describeElementStatus(row: {
  state: ElementState;
  optionCount: number;
  lockedValue: Record<string, unknown> | null;
  type: ElementType;
}): ElementTileInfo {
  if (row.state === "locked") {
    return {
      state: "locked",
      statusLabel: "Settled",
      detail: row.lockedValue ? summarizeOptionValue(row.type, row.lockedValue) : "?",
    };
  }
  return {
    state: "open",
    statusLabel: "Collecting ideas",
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
};
export type PlaceValue = LinkPreview & {
  name: string;
  booking_link?: string;
  price?: number;
  currency?: string;
};

export const PRICE_BEARING_TYPES: ElementType[] = [
  "travel",
  "accommodation",
  "experience",
  "dining",
];

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

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
      return { mode: "", note: "", booking_link: "", price: "", currency: "USD" };
    default:
      return { name: "", booking_link: "", price: "", currency: "USD" };
  }
}

/** Error message if the optional `price` field is present but not a number >= 0. */
function priceError(value: Record<string, unknown>): string | null {
  const raw = value.price;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "Price must be 0 or more";
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
      }
      return out;
    }
    default: {
      const out: PlaceValue = { name: str("name") };
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) {
        out.price = Number(value.price);
        out.currency = str("currency") || "USD";
      }
      return out;
    }
  }
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
      return str("price") ? `${base} · ${str("currency") || "USD"} ${str("price")}` : base;
    }
    default: {
      const base = [str("name"), str("booking_link")].filter(Boolean).join(" — ") || "?";
      return str("price") ? `${base} · ${str("currency") || "USD"} ${str("price")}` : base;
    }
  }
}
