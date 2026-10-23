import { describe, expect, it } from "vitest";
import { validateSupplierInterest, type SupplierInterestInput } from "./supplier-interest";

const base: SupplierInterestInput = {
  businessName: "  Hotel Canal  ",
  contactName: "Sam",
  email: "Sam@Example.com ",
  city: "Amsterdam",
  offering: "hotel",
  groupSize: "",
  website: "",
  note: "",
  source: "",
};

describe("validateSupplierInterest", () => {
  it("trims, lowercases the email and fills optional fields with null", () => {
    const r = validateSupplierInterest(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.business_name).toBe("Hotel Canal");
      expect(r.row.email).toBe("sam@example.com");
      expect(r.row.website).toBeNull();
      expect(r.row.group_size).toBeNull();
    }
  });

  it("requires the required fields and a known offering", () => {
    expect(validateSupplierInterest({ ...base, businessName: " " })).toEqual({ ok: false, error: "required" });
    expect(validateSupplierInterest({ ...base, offering: "castle" })).toEqual({ ok: false, error: "required" });
  });

  it("rejects bad emails, non-http websites and odd group sizes", () => {
    expect(validateSupplierInterest({ ...base, email: "not-an-email" })).toEqual({ ok: false, error: "email" });
    expect(validateSupplierInterest({ ...base, website: "javascript:alert(1)" })).toEqual({ ok: false, error: "website" });
    expect(validateSupplierInterest({ ...base, website: "www.example.com" })).toEqual({ ok: false, error: "website" });
    expect(validateSupplierInterest({ ...base, groupSize: "lots" })).toEqual({ ok: false, error: "groupSize" });
  });

  it("accepts http(s) websites and number or range group sizes", () => {
    expect(validateSupplierInterest({ ...base, website: "https://example.com", groupSize: "6-20" }).ok).toBe(true);
    expect(validateSupplierInterest({ ...base, groupSize: "12" }).ok).toBe(true);
  });

  it("limits lengths", () => {
    expect(validateSupplierInterest({ ...base, note: "x".repeat(1001) })).toEqual({ ok: false, error: "tooLong" });
  });

  it("keeps only safe characters in the source tag", () => {
    const r = validateSupplierInterest({ ...base, source: "Outreach-Oct<script>" });
    expect(r.ok && r.row.source).toBe("outreach-octscript");
  });
});
