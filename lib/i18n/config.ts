// Translations (founder, 2026-10-22: option A — a light setup now; new
// screens ship in English and Dutch, existing screens stay English until a
// separate translation pass). No locale in the URL: the language comes from
// the person's saved choice (cookie), else their browser's Accept-Language.

export const LOCALES = ["en", "nl"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "catoco_locale";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Saved choice wins; otherwise the first supported language in Accept-Language. */
export function resolveLocale(saved: string | undefined | null, acceptLanguage: string | undefined | null): Locale {
  if (isLocale(saved)) return saved;
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((p) => p.lang)
    .sort((a, b) => b.q - a.q);
  return prefs.map((p) => p.lang).find(isLocale) ?? DEFAULT_LOCALE;
}

/** "{name} owes {amount}" → filled from vars; unknown placeholders stay visible so gaps are obvious. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
