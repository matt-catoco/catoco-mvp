"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";

/** Saves the person's language choice for a year (no account change needed). */
export async function setLocale(locale: string): Promise<{ error?: string }> {
  if (!isLocale(locale)) return { error: "That language isn't available." };
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return {};
}
