import { describe, expect, it } from "vitest";
import { feeAllowed, isCollectionMode, type BookingRoute, type CollectionMode } from "./collection-modes";

describe("feeAllowed (one-sided fee rule, provisional)", () => {
  const routes: BookingRoute[] = ["api_booking", "affiliate_link", "supplier_bid", "proposed_link"];

  it("never charges a fee in pledge-only mode", () => {
    for (const r of routes) expect(feeAllowed("peer_pledge", r), r).toBe(false);
  });

  it("charges no fee where Catoco earns supplier income", () => {
    for (const m of ["catoco_psp", "vendor_direct"] as CollectionMode[]) {
      expect(feeAllowed(m, "affiliate_link")).toBe(false);
      expect(feeAllowed(m, "api_booking")).toBe(false);
    }
  });

  it("allows a fee where Catoco earns nothing from the supplier", () => {
    expect(feeAllowed("catoco_psp", "proposed_link")).toBe(true);
    expect(feeAllowed("vendor_direct", "supplier_bid")).toBe(true);
  });
});

describe("isCollectionMode", () => {
  it("accepts the three modes only", () => {
    expect(isCollectionMode("peer_pledge")).toBe(true);
    expect(isCollectionMode("stripe")).toBe(false);
  });
});
