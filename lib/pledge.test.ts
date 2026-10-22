import { describe, expect, it } from "vitest";
import { bookUnlocked, capAmount, epcQrPayload, formatIban, gapAmount, isValidIban, payWindowClosesAt } from "./pledge";

describe("IBAN", () => {
  it("accepts valid IBANs with spaces and lower case", () => {
    expect(isValidIban("NL91 ABNA 0417 1643 00")).toBe(true);
    expect(isValidIban("nl91abna0417164300")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
  });
  it("rejects a wrong check digit or format", () => {
    expect(isValidIban("NL92 ABNA 0417 1643 00")).toBe(false);
    expect(isValidIban("NL91")).toBe(false);
    expect(isValidIban("12345678")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });
  it("formats in groups of four", () => expect(formatIban("nl91abna0417164300")).toBe("NL91 ABNA 0417 1643 00"));
});

describe("EPC payment QR", () => {
  const base = { name: "Matt Savit", iban: "NL91ABNA0417164300", amount: 240, currency: "EUR", reference: "CTC-FE3D8D" };
  it("builds the SEPA credit transfer payload", () => {
    expect(epcQrPayload(base)).toBe(["BCD", "002", "1", "SCT", "", "Matt Savit", "NL91ABNA0417164300", "EUR240.00", "", "", "CTC-FE3D8D"].join("\n"));
  });
  it("is euro only and needs a valid IBAN and name", () => {
    expect(epcQrPayload({ ...base, currency: "USD" })).toBeNull();
    expect(epcQrPayload({ ...base, iban: "NL92ABNA0417164300" })).toBeNull();
    expect(epcQrPayload({ ...base, name: " " })).toBeNull();
    expect(epcQrPayload({ ...base, amount: 0 })).toBeNull();
  });
});

describe("share cap", () => {
  it("adds the cap percentage", () => {
    expect(capAmount(240, 10)).toBe(264);
    expect(capAmount(99.99, 0)).toBe(99.99);
    expect(capAmount(100, 15)).toBe(115);
  });
});

describe("Book gate", () => {
  it("opens when everyone in has paid their full share", () => {
    expect(bookUnlocked({ population: 3, share: 100, paid: [100, 100, 100], shortfallAccepted: false })).toBe(true);
  });
  it("stays shut with anyone short or missing", () => {
    expect(bookUnlocked({ population: 3, share: 100, paid: [100, 100, 60], shortfallAccepted: false })).toBe(false);
    expect(bookUnlocked({ population: 3, share: 100, paid: [100, 100], shortfallAccepted: false })).toBe(false);
    expect(bookUnlocked({ population: 0, share: 100, paid: [], shortfallAccepted: false })).toBe(false);
  });
  it("opens when the organizer covers the gap", () => {
    expect(bookUnlocked({ population: 3, share: 100, paid: [100], shortfallAccepted: true })).toBe(true);
  });
  it("measures the gap", () => {
    expect(gapAmount(1920, [240, 240, 240, 240, 240])).toBe(720);
    expect(gapAmount(100, [60, 50])).toBe(0);
  });
});

describe("pay window", () => {
  it("closes after the set hours", () => {
    expect(payWindowClosesAt("2027-09-01T10:00:00.000Z", 48)?.toISOString()).toBe("2027-09-03T10:00:00.000Z");
    expect(payWindowClosesAt(null, 48)).toBeNull();
    expect(payWindowClosesAt("2027-09-01T10:00:00.000Z", null)).toBeNull();
  });
});
