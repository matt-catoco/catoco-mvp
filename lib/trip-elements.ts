// Shared element metadata + value-shape validation for the trip-creation flow.
// The SQL function public.validate_option_value() mirrors validateOptionValue().

export const MACRO_TYPES = [
  "dates",
  "destination",
  "budget",
  "participants",
] as const;

export const MICRO_TYPES = [
  "travel",
  "accommodation",
  "experience",
  "dining",
] as const;

export type MacroType = (typeof MACRO_TYPES)[number];
export type MicroType = (typeof MICRO_TYPES)[number];
export type ElementType = MacroType | MicroType;

export const ALL_TYPES: ElementType[] = [...MACRO_TYPES, ...MICRO_TYPES];

export type ElementCategory = "macro" | "micro";
export type ElementState = "locked" | "open";
export type ElementStatus =
  | "add"
  | "vote"
  | "settled"
  | "collecting"
  | "funded"
  | "refunded"
  | "booked";

export const ELEMENT_LABELS: Record<ElementType, string> = {
  dates: "Dates",
  destination: "Destination",
  budget: "Budget",
  participants: "Participants",
  travel: "Travel",
  accommodation: "Accommodations",
  experience: "Experiences",
  dining: "Dining",
};

export const ELEMENT_BLURBS: Record<ElementType, string> = {
  dates: "When the trip happens",
  destination: "Where you're going",
  budget: "Rough spend per person",
  participants: "How many people",
  travel: "How you get there",
  accommodation: "Where you stay",
  experience: "Things to do",
  dining: "Where to eat",
};

export function categoryOf(type: ElementType): ElementCategory {
  return (MACRO_TYPES as readonly string[]).includes(type) ? "macro" : "micro";
}

// Two-letter marks for the tile grid (Trip Home dashboard + homepage demo).
// Single source so the two callers can't drift apart — previously these were
// hardcoded ad hoc in app/page.tsx only.
export const ELEMENT_SYMBOLS: Record<ElementType, string> = {
  dates: "Dt",
  destination: "Ds",
  budget: "Bg",
  participants: "Pt",
  travel: "Tr",
  accommodation: "Ac",
  experience: "Ex",
  dining: "Dn",
};

export const STATUS_LABELS: Record<ElementStatus, string> = {
  add: "Collecting ideas",
  vote: "Voting",
  settled: "Settled",
  collecting: "Collecting funds",
  funded: "Funded",
  refunded: "Refunded",
  booked: "Booked",
};

// Mirrors the CASE logic in public.create_trip(), which is the actual source
// of truth for what gets stamped into trip_elements.status on creation
// (locked -> 'settled', open with options -> 'add', open+empty -> null).
// The review screen shows its own friendlier labels — see
// app/trips/new/steps/review-step.tsx — rather than this raw stamping, so
// there's no JS-side "initial status" helper here to keep in sync with it.

// ---- Participants: a status lifecycle separate from the base element
// status above. Driven by the locked {min,max} range, the invites_sent flag
// (set explicitly by the organizer sharing the link), and the opted-in count
// from element_participants — never stored, always computed from those.

export type ParticipantsStatus =
  | "range_set"
  | "invites_sent"
  | "minimum_met"
  | "group_full";

export const PARTICIPANTS_STATUS_LABELS: Record<ParticipantsStatus, string> = {
  range_set: "Range set",
  invites_sent: "Invites sent",
  minimum_met: "Minimum met",
  group_full: "Group full",
};

export function computeParticipantsStatus({
  min,
  max,
  invitesSent,
  optedInCount,
}: {
  min: number | null;
  max: number | null;
  invitesSent: boolean;
  optedInCount: number;
}): ParticipantsStatus {
  if (max != null && optedInCount >= max) return "group_full";
  if (min != null && optedInCount >= min) return "minimum_met";
  if (invitesSent) return "invites_sent";
  return "range_set";
}

// ---- Trip Home tile status ---------------------------------------------
// One place implementing the tile-grid status vocabulary (dashboard +
// drill-in both read from this), so it isn't reimplemented per caller.
// "Not started" = no trip_elements row exists for this type (skipped at
// creation). A real, reachable state the ticket's 3-bucket vocabulary didn't
// name — an open element with zero candidate options yet — stays inside the
// "Collecting ideas" bucket rather than adding a new label; only the detail
// count text changes ("No ideas yet" vs "N ideas").

export type ElementTileInfo = {
  state: "locked" | "open";
  statusLabel: string;
  detail: string;
};

export function describeElementTile(args: {
  type: ElementType;
  row: null | {
    state: "locked" | "open";
    optionCount: number;
    lockedValue: Record<string, unknown> | null;
    participants?: {
      min: number | null;
      max: number | null;
      invitesSent: boolean;
      optedInCount: number;
    };
  };
}): ElementTileInfo {
  const { type, row } = args;

  if (!row) {
    return { state: "open", statusLabel: "Not started", detail: "" };
  }

  // Guarded on state === "locked" too, matching the pre-dashboard trip page's
  // condition — the wizard lets Participants be left "open" like any other
  // element (voted on via candidate ranges), in which case it isn't the
  // fixed range this branch describes and falls through to the generic open
  // handling below instead (summarizeOptionValue already has a "participants"
  // case, so that path renders it correctly).
  if (type === "participants" && row.state === "locked" && row.participants) {
    const status = computeParticipantsStatus({
      min: row.participants.min,
      max: row.participants.max,
      invitesSent: row.participants.invitesSent,
      optedInCount: row.participants.optedInCount,
    });
    return {
      state: "locked",
      statusLabel: PARTICIPANTS_STATUS_LABELS[status],
      detail: summarizeOptionValue("participants", {
        min: row.participants.min,
        max: row.participants.max,
      }),
    };
  }

  if (row.state === "locked") {
    return {
      state: "locked",
      statusLabel: "Settled",
      detail: row.lockedValue ? summarizeOptionValue(type, row.lockedValue) : "?",
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

// ---- value shapes (one per element type) -----------------------------------

export type DatesValue = {
  start_date: string;
  duration_nights?: number;
  end_date?: string;
  flexibility_days?: 0 | 1 | 2 | 3;
};
export type DestinationValue = { name: string };
export type BudgetValue =
  | { mode: "single"; amount: number; currency: string }
  | { mode: "range"; min: number; max: number; currency: string };
// `invited` is reserved for a future per-person-tracked invite mechanism —
// the one built now is a generic copy/paste link, so this stays empty.
export type ParticipantsValue = {
  min: number | null;
  max: number | null;
  invited?: string[];
};
// `price` (optional) is in the trip's budget currency, manually entered by
// whoever submits the option; used later by financing. `booking_link` is an
// MVP stand-in for real inventory — paste an Airbnb/hotel/flight/restaurant
// link. `title`/`description`/`thumbnail_url` are auto-extracted server-side
// from booking_link's Open Graph tags (see lib/link-preview.ts) — never set
// by the user directly. Later booking_link is replaced/supplemented by
// source + external_ref once API/MCP integration lands; not built now.
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
};
export type PlaceValue = LinkPreview & {
  name: string;
  booking_link?: string;
  price?: number;
};

export const PRICE_BEARING_TYPES: ElementType[] = [
  "travel",
  "accommodation",
  "experience",
  "dining",
];

export type OptionValue =
  | DatesValue
  | DestinationValue
  | BudgetValue
  | ParticipantsValue
  | TravelValue
  | PlaceValue;

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

export function emptyValueFor(type: ElementType): Record<string, unknown> {
  switch (type) {
    case "dates":
      return {
        start_date: "",
        end_date: "",
        duration_nights: "",
        flexibility_days: "",
      };
    case "destination":
      return { name: "" };
    case "budget":
      return { mode: "single", amount: "", min: "", max: "", currency: "USD" };
    case "participants":
      return { min: "", max: "" };
    case "travel":
      return { mode: "", note: "", booking_link: "", price: "" };
    default:
      return { name: "", booking_link: "", price: "" };
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
 * Returns an error message if `value` is not a valid option for `type`,
 * otherwise null. Accepts loosely-typed draft objects (strings from inputs).
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
      if (!str("start_date")) return "Pick a start date";
      if (str("end_date") && str("end_date") < str("start_date"))
        return "End date is before the start date";
      if (str("duration_nights")) {
        const n = num("duration_nights");
        if (!Number.isInteger(n) || n <= 0)
          return "Nights must be a whole number above 0";
      }
      if (str("flexibility_days") && !["0", "1", "2", "3"].includes(str("flexibility_days")))
        return "Flexibility must be 0–3 days";
      return null;
    }
    case "destination":
      return str("name") ? null : "Enter a destination";
    case "budget": {
      if (!str("currency")) return "Pick a currency";
      if (str("mode") === "range") {
        if (!str("min") || !Number.isFinite(num("min")) || num("min") <= 0)
          return "Enter a minimum above 0";
        if (!str("max") || !Number.isFinite(num("max")) || num("max") <= 0)
          return "Enter a maximum above 0";
        if (num("max") < num("min")) return "Maximum is below the minimum";
        return null;
      }
      if (!str("amount") || !Number.isFinite(num("amount")) || num("amount") <= 0)
        return "Enter an amount above 0";
      return null;
    }
    case "participants": {
      if (!str("min") && !str("max")) return "Set a minimum or maximum group size";
      if (str("min") && (!Number.isInteger(num("min")) || num("min") <= 0))
        return "Minimum must be a whole number above 0";
      if (str("max") && (!Number.isInteger(num("max")) || num("max") <= 0))
        return "Maximum must be a whole number above 0";
      if (str("min") && str("max") && num("max") < num("min"))
        return "Maximum is below the minimum";
      return null;
    }
    case "travel":
      if (!str("mode")) return "Enter a travel mode";
      return priceError(value);
    case "accommodation":
    case "experience":
    case "dining":
      if (!str("name")) return "Enter a name";
      return priceError(value);
    default:
      return "Unknown element type";
  }
}

/**
 * Cross-field check for open elements: options_deadline must be on or before
 * voting_deadline (can't accept new candidates after voting has closed).
 * Mirrors the check in public.create_trip(). Empty strings (unset) are fine.
 */
export function validateDeadlines(
  optionsDeadline: string,
  votingDeadline: string,
): string | null {
  if (optionsDeadline && votingDeadline && optionsDeadline > votingDeadline) {
    return "Options deadline must be on or before the voting deadline";
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
      const out: DatesValue = { start_date: str("start_date") };
      if (str("end_date")) out.end_date = str("end_date");
      if (str("duration_nights")) out.duration_nights = Number(value.duration_nights);
      if (str("flexibility_days"))
        out.flexibility_days = Number(value.flexibility_days) as 0 | 1 | 2 | 3;
      return out;
    }
    case "destination":
      return { name: str("name") };
    case "budget": {
      const currency = str("currency") || "USD";
      if (str("mode") === "range") {
        return { mode: "range", min: Number(value.min), max: Number(value.max), currency };
      }
      return { mode: "single", amount: Number(value.amount), currency };
    }
    case "participants": {
      const out: ParticipantsValue = {
        min: str("min") ? Number(value.min) : null,
        max: str("max") ? Number(value.max) : null,
      };
      return out;
    }
    case "travel": {
      const out: TravelValue = { mode: str("mode") };
      if (str("note")) out.note = str("note");
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) out.price = Number(value.price);
      return out;
    }
    default: {
      const out: PlaceValue = { name: str("name") };
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) out.price = Number(value.price);
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
      let base = str("start_date") || "?";
      if (str("end_date")) base += ` → ${str("end_date")}`;
      else if (str("duration_nights")) base += ` (${str("duration_nights")} nights)`;
      return flex ? `${base} · ±${flex}d` : base;
    }
    case "budget": {
      const cur = str("currency") || "USD";
      if (str("mode") === "range") return `${cur} ${str("min") || "?"}–${str("max") || "?"}`;
      return `${cur} ${str("amount") || "?"}`;
    }
    case "participants": {
      const min = str("min");
      const max = str("max");
      if (min && max) return `${min}–${max} people`;
      if (min) return `${min}+ people`;
      if (max) return `Up to ${max} people`;
      return "?";
    }
    case "travel": {
      const base =
        [str("mode"), str("note"), str("booking_link")].filter(Boolean).join(" — ") || "?";
      return str("price") ? `${base} · ${str("price")}` : base;
    }
    default: {
      const base = [str("name"), str("booking_link")].filter(Boolean).join(" — ") || "?";
      return str("price") ? `${base} · ${str("price")}` : base;
    }
  }
}
