import { describe, expect, it } from "vitest";
import { chooseChannels, defaultPreference, inQuietHours, pushLink } from "./channels";

const base = {
  kind: "vote_needed" as const,
  preference: null,
  emailOptedIn: true,
  hasDevice: true,
  emailAvailable: true,
  pushAvailable: true,
  quietHours: false,
};

describe("defaultPreference", () => {
  it("push with a device, email without", () => {
    expect(defaultPreference("vote_needed", true)).toBe("push");
    expect(defaultPreference("vote_needed", false)).toBe("email");
  });
  it("critical payment kinds go on both", () => {
    expect(defaultPreference("payment_retry_needed", false)).toBe("both");
    expect(defaultPreference("funding_needed", true)).toBe("both");
  });
});

describe("chooseChannels", () => {
  it("one channel per event by default (no duplicates)", () => {
    expect(chooseChannels(base)).toEqual({ email: false, push: true });
    expect(chooseChannels({ ...base, hasDevice: false })).toEqual({ email: true, push: false });
  });
  it("critical kinds send both", () => {
    expect(chooseChannels({ ...base, kind: "funding_needed" })).toEqual({ email: true, push: true });
  });
  it("only critical kinds or an explicit 'both' ever get two channels", () => {
    const kinds = ["invited", "nudge", "price_drift", "refund_requested", "shares_recalculated"] as const;
    for (const kind of kinds) {
      const r = chooseChannels({ ...base, kind });
      expect(r.email && r.push).toBe(false);
    }
    expect(chooseChannels({ ...base, preference: "both" })).toEqual({ email: true, push: true });
  });
  it("off sends nothing, even for critical kinds", () => {
    expect(chooseChannels({ ...base, kind: "payment_retry_needed", preference: "off" })).toEqual({ email: false, push: false });
  });
  it("push that can't be delivered falls back to email", () => {
    expect(chooseChannels({ ...base, pushAvailable: false })).toEqual({ email: true, push: false });
    expect(chooseChannels({ ...base, preference: "push", hasDevice: false })).toEqual({ email: true, push: false });
  });
  it("quiet hours: non-critical push becomes email, critical push still goes", () => {
    expect(chooseChannels({ ...base, quietHours: true })).toEqual({ email: true, push: false });
    expect(chooseChannels({ ...base, kind: "payment_retry_needed", quietHours: true })).toEqual({ email: true, push: true });
  });
  it("the email unsubscribe always wins for email, push still allowed", () => {
    expect(chooseChannels({ ...base, emailOptedIn: false, hasDevice: false })).toEqual({ email: false, push: false });
    expect(chooseChannels({ ...base, emailOptedIn: false })).toEqual({ email: false, push: true });
  });
  it("email preference ignores devices", () => {
    expect(chooseChannels({ ...base, preference: "email" })).toEqual({ email: true, push: false });
  });
  it("nothing when email is suppressed and push unavailable", () => {
    expect(chooseChannels({ ...base, emailAvailable: false, pushAvailable: false })).toEqual({ email: false, push: false });
  });
});

describe("inQuietHours", () => {
  it("22:00 to 08:00 in the device's zone", () => {
    const at = (iso: string) => new Date(iso);
    expect(inQuietHours(at("2026-10-23T21:30:00Z"), "Europe/Amsterdam")).toBe(true); // 23:30 local
    expect(inQuietHours(at("2026-10-23T05:59:00Z"), "Europe/Amsterdam")).toBe(true); // 07:59
    expect(inQuietHours(at("2026-10-23T06:00:00Z"), "Europe/Amsterdam")).toBe(false); // 08:00
    expect(inQuietHours(at("2026-10-23T12:00:00Z"), "Europe/Amsterdam")).toBe(false);
  });
  it("unknown zone reads as UTC", () => {
    expect(inQuietHours(new Date("2026-10-23T23:00:00Z"), "Not/AZone")).toBe(true);
    expect(inQuietHours(new Date("2026-10-23T12:00:00Z"), null)).toBe(false);
  });
});

describe("pushLink", () => {
  const origin = "https://www.catoco.co";
  it("takes the first trip link as a path", () => {
    const html = `<p><a href="${origin}/trips/abc/elements/def">Take a look</a> <a href="${origin}/trips/zzz">x</a></p>`;
    expect(pushLink(html, origin)).toBe("/trips/abc/elements/def");
  });
  it("drops query strings and ignores other origins", () => {
    expect(pushLink(`<a href="${origin}/trips/abc?x=1">x</a>`, origin)).toBe("/trips/abc");
    expect(pushLink(`<a href="https://evil.example/trips/abc">x</a>`, origin)).toBe("/trips");
  });
});
