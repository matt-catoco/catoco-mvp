// Which channel(s) an event goes out on (three-prong Prompt 4, 2026-10-23).
// Pure so it can be unit tested; lib/notifications.ts feeds it the facts.
//
// Defaults: one channel per event, push when the person has a recent device,
// else email. The critical payment kinds go on both. A person can override
// per kind (push, email, both, off). Push that can't be delivered (no
// device, no provider, quiet hours) falls back to email so nobody misses an
// event; the email unsubscribe still wins over everything for email.

import type { NotificationKind } from "@/lib/notifications";

export type ChannelPreference = "push" | "email" | "both" | "off";
export const CHANNEL_PREFERENCES: readonly ChannelPreference[] = ["push", "email", "both", "off"];

/** Sent on both channels by default and allowed through quiet hours. */
export const CRITICAL_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "payment_retry_needed",
  "funding_needed",
]);

/** A device counts as recent if it checked in within this many days. */
export const RECENT_DEVICE_DAYS = 30;

export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;

export function defaultPreference(kind: NotificationKind, hasDevice: boolean): ChannelPreference {
  if (CRITICAL_KINDS.has(kind)) return "both";
  return hasDevice ? "push" : "email";
}

export function chooseChannels(opts: {
  kind: NotificationKind;
  preference: ChannelPreference | null;
  /** profiles.email_notifications_enabled (the email unsubscribe link). */
  emailOptedIn: boolean;
  /** An active device that checked in recently. */
  hasDevice: boolean;
  /** Email may be sent in this environment (lib/email.ts). */
  emailAvailable: boolean;
  /** A push provider is configured and allowed for this recipient. */
  pushAvailable: boolean;
  /** The device's local time is inside the quiet window. */
  quietHours: boolean;
}): { email: boolean; push: boolean } {
  const pref = opts.preference ?? defaultPreference(opts.kind, opts.hasDevice);
  if (pref === "off") return { email: false, push: false };

  const critical = CRITICAL_KINDS.has(opts.kind);
  const wantPush = pref === "push" || pref === "both";
  let wantEmail = pref === "email" || pref === "both";

  const push = wantPush && opts.hasDevice && opts.pushAvailable && (critical || !opts.quietHours);
  // Push wanted but not deliverable now: email instead.
  if (wantPush && !push) wantEmail = true;

  const email = wantEmail && opts.emailOptedIn && opts.emailAvailable;
  return { email, push };
}

/** Hour (0-23) in the given IANA time zone; UTC when the zone is unknown. */
export function localHour(now: Date, timeZone: string | null | undefined): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timeZone || "UTC" }).format(now);
    return Number(h) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export function inQuietHours(now: Date, timeZone: string | null | undefined): boolean {
  const h = localHour(now, timeZone);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** First in-app link in an email body, as a path (/trips/…); else /trips. */
export function pushLink(html: string, origin: string): string {
  const esc = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp(`href="${esc}(/trips/[^"?#]*)`));
  return m?.[1] ?? "/trips";
}
