// Supplier early list (/for-suppliers): pure validation shared by the server
// action and its tests. Covered by lib/supplier-interest.test.ts.

/** Where new sign-ups are emailed. Matt confirms the mailbox exists before production. */
export const SUPPLIER_INTEREST_NOTIFY = "partnerships@catoco.co";

export const OFFERINGS = ["hotel", "apartment", "restaurant", "venue", "transport", "activity", "other"] as const;
export type Offering = (typeof OFFERINGS)[number];

export const LIMITS = {
  businessName: 200,
  contactName: 200,
  email: 320,
  city: 120,
  groupSize: 40,
  website: 500,
  note: 1000,
  source: 100,
} as const;

export type SupplierInterestInput = {
  businessName: string;
  contactName: string;
  email: string;
  city: string;
  offering: string;
  groupSize: string;
  website: string;
  note: string;
  source: string;
};

export type SupplierInterest = {
  business_name: string;
  contact_name: string;
  email: string;
  city: string;
  offering: Offering;
  group_size: string | null;
  website: string | null;
  note: string | null;
  source: string | null;
};

export type ValidationError = "required" | "email" | "website" | "groupSize" | "tooLong";

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** Trims and checks every field. Returns the row to store, or the first problem. */
export function validateSupplierInterest(raw: SupplierInterestInput): { ok: true; row: SupplierInterest } | { ok: false; error: ValidationError } {
  const businessName = clean(raw.businessName);
  const contactName = clean(raw.contactName);
  const email = clean(raw.email).toLowerCase();
  const city = clean(raw.city);
  const offering = clean(raw.offering);
  const groupSize = clean(raw.groupSize);
  const website = clean(raw.website);
  // Keep line breaks in the note, just trim it.
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  const source = clean(raw.source).toLowerCase().replace(/[^a-z0-9_-]/g, "");

  if (!businessName || !contactName || !email || !city || !(OFFERINGS as readonly string[]).includes(offering)) {
    return { ok: false, error: "required" };
  }
  if (
    businessName.length > LIMITS.businessName ||
    contactName.length > LIMITS.contactName ||
    email.length > LIMITS.email ||
    city.length > LIMITS.city ||
    groupSize.length > LIMITS.groupSize ||
    website.length > LIMITS.website ||
    note.length > LIMITS.note
  ) {
    return { ok: false, error: "tooLong" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "email" };
  if (groupSize && !/^\d{1,4}(\s*[-–]\s*\d{1,4})?$/.test(groupSize)) return { ok: false, error: "groupSize" };
  if (website) {
    let url: URL | null = null;
    try {
      url = new URL(website);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !/^https?:\/\//i.test(website)) {
      return { ok: false, error: "website" };
    }
  }

  return {
    ok: true,
    row: {
      business_name: businessName,
      contact_name: contactName,
      email,
      city,
      offering: offering as Offering,
      group_size: groupSize || null,
      website: website || null,
      note: note || null,
      source: source.slice(0, LIMITS.source) || null,
    },
  };
}
