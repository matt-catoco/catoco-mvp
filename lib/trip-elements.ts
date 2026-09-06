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
// §3: lat/lng/place_id are the Mapbox-resolved fields (components/
// place-picker.tsx) — undefined until a real geocoding call is wired (see
// app/api/geocode/route.ts), harmless either way since name alone is what
// validateOptionValue actually requires.
export type DestinationValue = {
  name: string;
  lat?: number;
  lng?: number;
  place_id?: string;
};
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
// ---- §5 Travel: fixed Mode enum, not free text/autocomplete — clean enum
// values for vendor-API routing later (Travelpayouts for flights, etc.);
// free text would reintroduce the "Flights/Fights/flight/plane" mess.
export const TRAVEL_MODES = ["flight", "train", "bus", "rental_car", "ferry", "other"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  rental_car: "Rental car",
  ferry: "Ferry",
  other: "Other",
};

export type TravelValue = LinkPreview & {
  mode: TravelMode | "";
  note?: string;
  start_location?: string;
  destination_location?: string;
  round_trip?: boolean;
  booking_link?: string;
  price?: number;
  currency?: string;
  pricing_basis?: string;
};

// ---- §6 Accommodations: Subtype + conditional fields. Practical starting
// draft, not gospel — confirm against whatever live vendor endpoint gets
// integrated later (Booking.com's /accommodations/constants, or
// Travelpayouts/Hotellook's hotel-type list) before treating this as final.
export const ACCOMMODATION_SUBTYPES = [
  "hotel",
  "bnb",
  "home_apartment",
  "villa",
  "chalet",
  "cabin_cottage",
  "guesthouse",
  "hostel",
  "glamping",
  "hut",
  "camper_van",
  "boat_houseboat",
  "campsite",
  "farm_stay",
  "aparthotel",
  "resort",
  "other",
] as const;
export type AccommodationSubtype = (typeof ACCOMMODATION_SUBTYPES)[number];
export const ACCOMMODATION_SUBTYPE_LABELS: Record<AccommodationSubtype, string> = {
  hotel: "Hotel",
  bnb: "B&B",
  home_apartment: "Home/apartment",
  villa: "Villa",
  chalet: "Chalet",
  cabin_cottage: "Cabin/Cottage",
  guesthouse: "Guesthouse",
  hostel: "Hostel",
  glamping: "Glamping",
  hut: "Hut (mountain/refuge-style)",
  camper_van: "Camper van/RV",
  boat_houseboat: "Boat/houseboat",
  campsite: "Campsite",
  farm_stay: "Farm stay",
  aparthotel: "Aparthotel",
  resort: "Resort",
  other: "Other",
};

// Which conditional fields (§6) apply per subtype — data-driven instead of a
// giant per-subtype switch, so adding/adjusting a subtype's fields later is
// a one-line change here, not a new UI branch.
export type AccommodationFieldKey =
  | "rooms"
  | "guests"
  | "breakfast"
  | "bedrooms"
  | "beds"
  | "bathrooms"
  | "max_guests"
  | "room_type_private_dorm"
  | "num_beds"
  | "unit_type"
  | "room_type_private_shared"
  | "bedding_provided"
  | "sleeping_capacity"
  | "num_vehicles"
  | "berths"
  | "num_sites";

export const ACCOMMODATION_SUBTYPE_FIELDS: Record<AccommodationSubtype, AccommodationFieldKey[]> = {
  hotel: ["rooms", "guests", "breakfast"],
  bnb: ["rooms", "guests", "breakfast"],
  home_apartment: ["bedrooms", "beds", "bathrooms", "max_guests"],
  villa: ["bedrooms", "beds", "bathrooms", "max_guests"],
  chalet: ["bedrooms", "beds", "bathrooms", "max_guests"],
  cabin_cottage: ["bedrooms", "beds", "bathrooms", "max_guests"],
  farm_stay: ["bedrooms", "beds", "bathrooms", "max_guests"],
  aparthotel: ["bedrooms", "beds", "bathrooms", "max_guests"],
  resort: ["bedrooms", "beds", "bathrooms", "max_guests"],
  guesthouse: [],
  hostel: ["room_type_private_dorm", "num_beds", "guests"],
  glamping: ["guests", "unit_type"],
  hut: ["guests", "room_type_private_shared", "bedding_provided"],
  camper_van: ["sleeping_capacity", "num_vehicles"],
  boat_houseboat: ["berths", "guests"],
  campsite: ["num_sites", "guests"],
  other: [],
};

export const ACCOMMODATION_FIELD_LABELS: Record<AccommodationFieldKey, string> = {
  rooms: "# of rooms",
  guests: "# of guests",
  breakfast: "Breakfast included",
  bedrooms: "Bedrooms",
  beds: "Beds",
  bathrooms: "Bathrooms",
  max_guests: "Max guests",
  room_type_private_dorm: "Room type",
  num_beds: "# of beds",
  unit_type: "Unit type",
  room_type_private_shared: "Room type",
  bedding_provided: "Bedding provided",
  sleeping_capacity: "Sleeping capacity",
  num_vehicles: "# of vehicles",
  berths: "# of berths",
  num_sites: "# of sites/tents",
};

// ---- §7 Experiences: Subtype/genre. Sports/concert ticketing will
// eventually need a different vendor category (Ticketmaster/SeatGeek-style,
// not activity-tour APIs like Viator) — this field lays that groundwork,
// not building the second integration now.
export const EXPERIENCE_SUBTYPES = [
  "tour_sightseeing",
  "sporting_event",
  "concert_show",
  "museum_attraction",
  "outdoor_adventure",
  "class_workshop",
  "nightlife",
  "other",
] as const;
export type ExperienceSubtype = (typeof EXPERIENCE_SUBTYPES)[number];
export const EXPERIENCE_SUBTYPE_LABELS: Record<ExperienceSubtype, string> = {
  tour_sightseeing: "Tour/Sightseeing",
  sporting_event: "Sporting event",
  concert_show: "Concert/Show",
  museum_attraction: "Museum/Attraction",
  outdoor_adventure: "Outdoor/Adventure",
  class_workshop: "Class/Workshop",
  nightlife: "Nightlife",
  other: "Other",
};

// ---- §8 Dining: cuisine, grouped for maintainability (not a flat 60-item
// dropdown with no structure).
export const CUISINE_GROUPS: { group: string; cuisines: string[] }[] = [
  {
    group: "Regional/national",
    cuisines: [
      "Italian", "French", "Spanish", "Greek", "Mediterranean", "American",
      "Southern/Soul food", "Cajun/Creole", "Tex-Mex", "Mexican", "Latin American",
      "Peruvian", "Brazilian", "Caribbean", "Cuban", "Chinese", "Japanese", "Korean",
      "Thai", "Vietnamese", "Filipino", "Indonesian", "Malaysian", "Indian", "Pakistani",
      "Middle Eastern", "Lebanese", "Turkish", "Moroccan", "Ethiopian", "West African",
      "German", "British", "Irish", "Scandinavian/Nordic", "Portuguese",
      "Eastern European/Russian", "Hawaiian/Polynesian",
    ],
  },
  {
    group: "Format/style",
    cuisines: [
      "Seafood", "Steakhouse/BBQ", "Pizza", "Burgers", "Sushi", "Ramen/Noodles",
      "Sandwiches/Deli", "Bakery/Café", "Breakfast/Brunch", "Buffet", "Fine dining",
      "Fast food/Casual", "Food truck/Street food", "Fusion", "Dessert/Ice cream",
      "Wine bar/Tapas", "Brewery/Gastropub",
    ],
  },
  {
    group: "Dietary",
    cuisines: ["Vegetarian/Vegan", "Gluten-free", "Farm-to-table"],
  },
  {
    group: "Other",
    cuisines: ["Other"],
  },
];

export const PRICING_TIERS = ["$", "$$", "$$$", "$$$$"] as const;
export type PricingTier = (typeof PRICING_TIERS)[number];

export type PlaceValue = LinkPreview & {
  name: string;
  booking_link?: string;
  price?: number;
  currency?: string;
  pricing_basis?: string;
  // §6 Accommodations
  subtype?: AccommodationSubtype | "";
  accommodation_fields?: Partial<Record<AccommodationFieldKey, string>>;
  dates?: DatesValue;
  // §7 Experiences
  experience_subtype?: ExperienceSubtype | "";
  // §7/§8 location (Mapbox-backed, same shape as Destination)
  location_name?: string;
  location_lat?: number;
  location_lng?: number;
  location_place_id?: string;
  // §8 Dining
  guests?: number;
  cuisine?: string;
  price_tier?: PricingTier | "";
};

export const PRICE_BEARING_TYPES: ElementType[] = [
  "travel",
  "accommodation",
  "experience",
  "dining",
];

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "$",
  AUD: "$",
};

/**
 * "$20 USD" style — symbol for quick visual recognition, ISO code kept
 * alongside since a bare symbol is ambiguous (e.g. "$" alone doesn't
 * distinguish USD/CAD/AUD). Used everywhere a price/amount renders (option
 * tiles, funding required/collected, contributions) — never a bare
 * "USD 20" string. Exact visual styling is a design-chat follow-up; this is
 * the content rule.
 */
export function formatCurrency(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  const value = amount.toFixed(2);
  return symbol ? `${symbol}${value} ${currency}` : `${value} ${currency}`;
}

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

// §4: cross-element trip-level data sharing. The trip's locked
// Destination/Dates elements (see app/trips/[tripId]/trip-context.ts,
// which does the actual DB read) are context every other element's forms
// can be pre-filled from instead of asking the same thing per element.
export type TripContext = {
  destination?: { name: string; lat?: number; lng?: number; place_id?: string };
  dates?: { start_date?: string; end_date?: string; nights?: number };
};

/**
 * Seeds an otherwise-empty draft value with trip-level context — only fills
 * fields the draft hasn't already got something in, so it never clobbers
 * what someone typed. Destination context pre-fills Travel's destination
 * leg and Experiences'/Dining's location; Dates context pre-fills
 * Accommodations' optional Dates sub-field.
 */
export function applyTripContext(
  type: ElementType,
  value: Record<string, unknown>,
  ctx: TripContext | null | undefined,
): Record<string, unknown> {
  if (!ctx) return value;
  const out = { ...value };
  if (ctx.destination) {
    if ((type === "experience" || type === "dining") && !String(out.location_name ?? "").trim()) {
      out.location_name = ctx.destination.name;
      if (ctx.destination.lat !== undefined) out.location_lat = ctx.destination.lat;
      if (ctx.destination.lng !== undefined) out.location_lng = ctx.destination.lng;
      if (ctx.destination.place_id) out.location_place_id = ctx.destination.place_id;
    }
    if (type === "travel" && !String(out.destination_location ?? "").trim()) {
      out.destination_location = ctx.destination.name;
    }
  }
  if (ctx.dates && type === "accommodation") {
    const existingDates = (out.dates ?? {}) as Record<string, unknown>;
    if (!String(existingDates.start_date ?? "").trim() && !String(existingDates.nights ?? "").trim()) {
      out.dates = {
        start_date: ctx.dates.start_date ?? "",
        end_date: ctx.dates.end_date ?? "",
        nights: ctx.dates.nights ? String(ctx.dates.nights) : "",
        flexibility_days: "",
      };
    }
  }
  return out;
}

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
      return { name: "", lat: "", lng: "", place_id: "" };
    case "travel":
      return {
        mode: "",
        note: "",
        start_location: "",
        destination_location: "",
        round_trip: true,
        booking_link: "",
        price: "",
        currency: "USD",
        pricing_basis: defaultPricingBasisFor("travel"),
      };
    case "accommodation":
      return {
        name: "",
        subtype: "",
        accommodation_fields: {},
        dates: { start_date: "", end_date: "", nights: "", flexibility_days: "" },
        booking_link: "",
        price: "",
        currency: "USD",
        pricing_basis: defaultPricingBasisFor("accommodation"),
      };
    case "experience":
      return {
        name: "",
        experience_subtype: "",
        location_name: "",
        location_lat: "",
        location_lng: "",
        location_place_id: "",
        booking_link: "",
        price: "",
        currency: "USD",
        pricing_basis: defaultPricingBasisFor("experience"),
      };
    case "dining":
      return {
        name: "",
        location_name: "",
        location_lat: "",
        location_lng: "",
        location_place_id: "",
        booking_link: "",
        guests: "",
        cuisine: "",
        price_tier: "",
      };
  }
}

/**
 * Error message for the `price` field. Required by default (§1) — the one
 * exception is a type/subtype-specific "Other" selection (Travel's Mode =
 * Other, Accommodations' Subtype = Other), where a price can't reasonably be
 * pinned down yet and stays optional.
 */
function priceError(value: Record<string, unknown>, opts?: { optional?: boolean }): string | null {
  const raw = value.price;
  const isEmpty = raw === undefined || raw === null || String(raw).trim() === "";
  if (isEmpty) return opts?.optional ? null : "Enter a price";
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
      if (!str("end_date")) return "Pick an end date";
      if (str("end_date") < str("start_date")) return "End date is before the start date";
      return null;
    }
    case "destination":
      return str("name") ? null : "Enter a destination";
    case "travel": {
      if (!(TRAVEL_MODES as readonly string[]).includes(str("mode"))) return "Pick a travel mode";
      if (str("mode") === "other" && !str("note")) return "Describe the travel mode";
      return bookingLinkError(value) ?? priceError(value, { optional: str("mode") === "other" });
    }
    case "accommodation": {
      if (!str("name")) return "Enter a name";
      if (!(ACCOMMODATION_SUBTYPES as readonly string[]).includes(str("subtype")))
        return "Pick a property type";
      return bookingLinkError(value) ?? priceError(value, { optional: str("subtype") === "other" });
    }
    case "experience": {
      if (!str("name")) return "Enter a name";
      if (!(EXPERIENCE_SUBTYPES as readonly string[]).includes(str("experience_subtype")))
        return "Pick a category";
      return bookingLinkError(value) ?? priceError(value);
    }
    case "dining": {
      if (!str("name")) return "Enter a name";
      if (!(PRICING_TIERS as readonly string[]).includes(str("price_tier")))
        return "Pick a price range";
      return bookingLinkError(value);
    }
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
    case "destination": {
      const out: DestinationValue = { name: str("name") };
      if (str("lat")) out.lat = Number(value.lat);
      if (str("lng")) out.lng = Number(value.lng);
      if (str("place_id")) out.place_id = str("place_id");
      return out;
    }
    case "travel": {
      const out: TravelValue = { mode: str("mode") as TravelMode | "" };
      if (str("note")) out.note = str("note");
      if (str("mode") !== "other") {
        if (str("start_location")) out.start_location = str("start_location");
        if (str("destination_location")) out.destination_location = str("destination_location");
        out.round_trip = Boolean(value.round_trip);
      }
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) {
        out.price = Number(value.price);
        out.currency = str("currency") || "USD";
        out.pricing_basis = str("pricing_basis");
      }
      return out;
    }
    case "accommodation": {
      const out: PlaceValue = { name: str("name"), subtype: str("subtype") as AccommodationSubtype | "" };
      const fieldKeys = ACCOMMODATION_SUBTYPE_FIELDS[str("subtype") as AccommodationSubtype] ?? [];
      if (fieldKeys.length) {
        const raw = (value.accommodation_fields ?? {}) as Record<string, unknown>;
        const fields: Partial<Record<AccommodationFieldKey, string>> = {};
        for (const k of fieldKeys) {
          const v = String(raw[k] ?? "").trim();
          if (v) fields[k] = v;
        }
        if (Object.keys(fields).length) out.accommodation_fields = fields;
      }
      const rawDates = (value.dates ?? {}) as Record<string, unknown>;
      if (String(rawDates.start_date ?? "").trim() || String(rawDates.nights ?? "").trim()) {
        out.dates = normalizeOptionValue("dates", rawDates) as DatesValue;
      }
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) {
        out.price = Number(value.price);
        out.currency = str("currency") || "USD";
        out.pricing_basis = str("pricing_basis");
      }
      return out;
    }
    case "experience": {
      const out: PlaceValue = {
        name: str("name"),
        experience_subtype: str("experience_subtype") as ExperienceSubtype | "",
      };
      if (str("location_name")) {
        out.location_name = str("location_name");
        if (str("location_lat")) out.location_lat = Number(value.location_lat);
        if (str("location_lng")) out.location_lng = Number(value.location_lng);
        if (str("location_place_id")) out.location_place_id = str("location_place_id");
      }
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("price")) {
        out.price = Number(value.price);
        out.currency = str("currency") || "USD";
        out.pricing_basis = str("pricing_basis");
      }
      return out;
    }
    case "dining": {
      const out: PlaceValue = { name: str("name") };
      if (str("location_name")) {
        out.location_name = str("location_name");
        if (str("location_lat")) out.location_lat = Number(value.location_lat);
        if (str("location_lng")) out.location_lng = Number(value.location_lng);
        if (str("location_place_id")) out.location_place_id = str("location_place_id");
      }
      if (str("booking_link")) out.booking_link = str("booking_link");
      if (str("guests")) out.guests = Number(value.guests);
      if (str("cuisine")) out.cuisine = str("cuisine");
      if (str("price_tier")) out.price_tier = str("price_tier") as PricingTier;
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

/**
 * Human-readable date, e.g. "Nov 2, 2026" — the one consistent format used
 * everywhere a date is *shown* (not inside a form input, which keeps native
 * <input type="date"> as-is). Formats in UTC deliberately: these are bare
 * YYYY-MM-DD strings with no time component, and letting the browser's local
 * timezone interpret them can shift the displayed date by a day in either
 * direction (e.g. "2026-11-02" parsed as UTC midnight reads as "Nov 1" for
 * anyone west of UTC) — UTC formatting keeps what's shown matching exactly
 * what was typed in, everywhere.
 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
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
        base = str("start_date") ? formatDate(str("start_date")) : "?";
        if (str("end_date")) base += ` → ${formatDate(str("end_date"))}`;
      }
      return flex ? `${base} · ±${flex}d` : base;
    }
    case "destination":
      return str("name") || "?";
    case "travel": {
      // No raw booking_link here — it's not even a clickable link as tile
      // text, just a wall of characters that can run past 200+ chars with
      // query params and blow out the tile's box. Prefer the server-scraped
      // title (applyLinkPreview(), Open Graph tags) when the link resolved;
      // otherwise fall back to what was actually typed in.
      const modeLabel = str("mode") ? TRAVEL_MODE_LABELS[str("mode") as TravelMode] ?? str("mode") : "";
      const base = str("title") || [modeLabel, str("note")].filter(Boolean).join(" — ") || "?";
      return str("price") ? `${base} · ${priceLabel(value)}` : base;
    }
    case "accommodation":
    case "experience": {
      const base = str("title") || str("name") || "?";
      return str("price") ? `${base} · ${priceLabel(value)}` : base;
    }
    case "dining": {
      const base = str("title") || str("name") || "?";
      return str("price_tier") ? `${base} · ${str("price_tier")}` : base;
    }
  }
}

function priceLabel(value: Record<string, unknown>): string {
  const str = (k: string) => String(value[k] ?? "").trim();
  const basis = str("pricing_basis");
  const suffix =
    basis === "per_night" ? "/night" : basis === "per_person" ? "/person" : "";
  const price = Number(str("price"));
  const formatted = Number.isFinite(price)
    ? formatCurrency(price, str("currency") || "USD")
    : `${str("currency") || "USD"} ${str("price")}`;
  return `${formatted}${suffix}`;
}
