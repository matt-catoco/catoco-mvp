import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { dictionaries, type Dictionary } from "./dictionaries";

export async function getLocale(): Promise<Locale> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value, h.get("accept-language"));
}

export async function getDictionary(locale?: Locale): Promise<{ locale: Locale; t: Dictionary }> {
  const l = locale ?? (await getLocale());
  return { locale: l, t: dictionaries[l] };
}
