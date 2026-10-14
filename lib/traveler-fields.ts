import type { ElementType } from "@/lib/trip-elements";

/**
 * Traveler details collected at the commit step only (founder spec,
 * 2026-10-10; gender + phone added 2026-10-11 — airline orders need both).
 * We store ONLY name, date of birth, gender, email and phone — never
 * passport or ID numbers. Anything a vendor needs beyond these is a
 * stop-and-ask, not a field to add here.
 */
export type TravelerField =
  | "legal_first_name"
  | "legal_last_name"
  | "full_name"
  | "date_of_birth"
  | "gender"
  | "email"
  | "phone";

export const TRAVELER_FIELD_LABEL: Record<TravelerField, string> = {
  legal_first_name: "First name (exactly as on your passport/ID)",
  legal_last_name: "Last name (exactly as on your passport/ID)",
  full_name: "Full name",
  date_of_birth: "Date of birth",
  gender: "Gender (as on your passport/ID)",
  email: "Email",
  phone: "Mobile phone (with country code)",
};

/** Airline systems (Duffel) accept only these two passport markers. */
export const GENDER_OPTIONS = ["Female", "Male"] as const;

/** Who has to provide details: every traveler, or just the lead guest. */
export type TravelerScope = "each" | "lead";

export type TravelerRequirement = { scope: TravelerScope; fields: TravelerField[] };

export const ALL_TRAVELER_FIELDS: TravelerField[] = [
  "legal_first_name",
  "legal_last_name",
  "full_name",
  "date_of_birth",
  "gender",
  "email",
  "phone",
];

export function defaultRequirement(type: ElementType, value?: Record<string, unknown>): TravelerRequirement | null {
  switch (type) {
    case "travel":
      // Flights: each traveler, legal name as on passport + DOB + gender +
      // email + phone (airlines require gender and a contact phone).
      return value?.mode === "flight"
        ? { scope: "each", fields: ["legal_first_name", "legal_last_name", "date_of_birth", "gender", "email", "phone"] }
        : null;
    case "accommodation":
      // Lead guest; hotels ask for a contact phone (founder, 2026-10-14).
      return { scope: "lead", fields: ["full_name", "email", "phone"] };
    case "experience":
      // + headcount, which is the element's participant count — not personal data.
      return { scope: "lead", fields: ["full_name", "email"] };
    case "dining":
      // Lead guest for the reservation (was headcount only; founder, 2026-10-14).
      return { scope: "lead", fields: ["full_name", "email", "phone"] };
    default:
      return null;
  }
}

/** The element's requirement: an organizer override (from a manually added
 * option's vendor) wins, else the type default. Unknown fields are dropped. */
export function requirementFor(
  type: ElementType,
  value: Record<string, unknown> | undefined,
  override: unknown,
): TravelerRequirement | null {
  if (override && typeof override === "object") {
    const o = override as { scope?: unknown; fields?: unknown };
    const fields = Array.isArray(o.fields)
      ? (o.fields.filter((f) => ALL_TRAVELER_FIELDS.includes(f as TravelerField)) as TravelerField[])
      : [];
    if (fields.length === 0) return null;
    return { scope: o.scope === "lead" ? "lead" : "each", fields };
  }
  return defaultRequirement(type, value);
}

export type TravelerDetails = Partial<Record<TravelerField, string>>;

export function missingFields(req: TravelerRequirement, d: TravelerDetails | null): TravelerField[] {
  return req.fields.filter((f) => !(d?.[f] ?? "").trim());
}

/** Basic shape checks — the person confirms the values match their ID. */
export function travelerDetailsError(req: TravelerRequirement, d: TravelerDetails): string | null {
  for (const f of req.fields) {
    const v = (d[f] ?? "").trim();
    if (!v) {
      const label = TRAVELER_FIELD_LABEL[f];
      return `Add your ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
    }
    if (v.length > 200) return "That's too long.";
  }
  if (req.fields.includes("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((d.email ?? "").trim())) return "Check the email address.";
  if (req.fields.includes("date_of_birth")) {
    const dob = (d.date_of_birth ?? "").trim();
    const t = Date.parse(`${dob}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(t) || t > Date.now() || t < Date.parse("1900-01-01")) {
      return "Check the date of birth.";
    }
  }
  if (req.fields.includes("gender") && !(GENDER_OPTIONS as readonly string[]).includes((d.gender ?? "").trim())) {
    return "Choose the gender shown on your passport/ID.";
  }
  if (req.fields.includes("phone")) {
    const phone = (d.phone ?? "").trim();
    const digits = phone.replace(/\D/g, "");
    if (!/^\+[\d\s().-]+$/.test(phone) || digits.length < 8 || digits.length > 15) {
      return "Add your mobile number with the country code, e.g. +44 7700 900123.";
    }
  }
  return null;
}

/** Retention (founder, 2026-10-10): deleted this many days after the trip ends. */
export const TRAVELER_DETAILS_RETENTION_DAYS = 90;
