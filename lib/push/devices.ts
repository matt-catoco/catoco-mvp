// Validation for /api/push/devices (three-prong Prompt 4, 2026-10-23). Pure,
// so it can be unit tested.

import { isLocale, type Locale } from "@/lib/i18n/config";

export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type DeviceRegistration = {
  platform: Platform;
  token: string;
  appVersion: string | null;
  locale: Locale;
  timeZone: string | null;
};

const TOKEN_RE = /^[A-Za-z0-9:_\-.]{16,4096}$/;

export function validToken(raw: unknown): string | null {
  return typeof raw === "string" && TOKEN_RE.test(raw.trim()) ? raw.trim() : null;
}

function validTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

export function validateRegistration(raw: unknown): DeviceRegistration | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const platform = (PLATFORMS as readonly unknown[]).includes(r.platform) ? (r.platform as Platform) : null;
  const token = validToken(r.token);
  if (!platform || !token) return null;
  const appVersion = typeof r.appVersion === "string" && r.appVersion.trim() ? r.appVersion.trim().slice(0, 40) : null;
  return {
    platform,
    token,
    appVersion,
    locale: isLocale(r.locale) ? r.locale : "en",
    timeZone: validTimeZone(r.timeZone),
  };
}
