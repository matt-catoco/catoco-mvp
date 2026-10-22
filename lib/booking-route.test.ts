import { describe, expect, it } from "vitest";
import { bookingRouteFor, outboundUrl, subIdFor } from "./booking-route";

const sub = subIdFor("fr1", "el1");

describe("booking route", () => {
  it("treats partner links as affiliate links", () => {
    expect(bookingRouteFor({ booking_link: "https://www.viator.com/tours/Seville/x/d123-1?pid=P1&mcid=42" })).toBe("affiliate_link");
    expect(bookingRouteFor({ booking_link: "https://www.booking.com/hotel/es/x.html" })).toBe("affiliate_link");
  });
  it("treats any other link as a proposed link", () => {
    expect(bookingRouteFor({ booking_link: "https://hotelpatioazul.example/book" })).toBe("proposed_link");
  });
  it("has no route without a usable link (API-only options: intentionally unbuilt)", () => {
    expect(bookingRouteFor({ vendor_source: "duffel", vendor_offer_id: "off_1", booking_link: "" })).toBeNull();
    expect(bookingRouteFor({ booking_link: "javascript:alert(1)" })).toBeNull();
  });
});

describe("outbound url", () => {
  it("adds the sub-ID to partner links, keeping their own parameters", () => {
    const u = new URL(outboundUrl({ booking_link: "https://www.viator.com/tours/x?pid=P1&mcid=42" }, sub)!);
    expect(u.searchParams.get("campaign")).toBe("fr1.el1");
    expect(u.searchParams.get("pid")).toBe("P1");
    expect(new URL(outboundUrl({ booking_link: "https://www.booking.com/hotel/es/x.html" }, sub)!).searchParams.get("label")).toBe("fr1.el1");
  });
  it("opens pasted links unchanged", () => {
    expect(outboundUrl({ booking_link: "https://hotelpatioazul.example/book?x=1" }, sub)).toBe("https://hotelpatioazul.example/book?x=1");
  });
  it("refuses anything that isn't http(s)", () => {
    expect(outboundUrl({ booking_link: "data:text/html,hi" }, sub)).toBeNull();
  });
});
