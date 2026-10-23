import { describe, expect, it } from "vitest";
import { validateRegistration, validToken } from "./devices";

const token = "fcm:APA91bH-abc_DEF.1234567890";

describe("validateRegistration", () => {
  it("accepts a full registration", () => {
    expect(
      validateRegistration({ platform: "ios", token, appVersion: " 1.0.3 ", locale: "nl", timeZone: "Europe/Amsterdam" }),
    ).toEqual({ platform: "ios", token, appVersion: "1.0.3", locale: "nl", timeZone: "Europe/Amsterdam" });
  });
  it("defaults locale and drops a bad time zone", () => {
    expect(validateRegistration({ platform: "android", token, locale: "fr", timeZone: "Mars/Base" })).toEqual({
      platform: "android",
      token,
      appVersion: null,
      locale: "en",
      timeZone: null,
    });
  });
  it("rejects unknown platforms and bad tokens", () => {
    expect(validateRegistration({ platform: "windows", token })).toBeNull();
    expect(validateRegistration({ platform: "ios", token: "short" })).toBeNull();
    expect(validateRegistration({ platform: "ios", token: "has spaces in it, not a token" })).toBeNull();
    expect(validateRegistration(null)).toBeNull();
  });
});

describe("validToken", () => {
  it("trims and checks", () => {
    expect(validToken(`  ${token} `)).toBe(token);
    expect(validToken(42)).toBeNull();
  });
});
