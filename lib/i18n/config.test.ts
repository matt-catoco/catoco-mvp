import { describe, expect, it } from "vitest";
import { fmt, resolveLocale } from "./config";
import { dictionaries, NEEDS_REVIEW } from "./dictionaries";

describe("resolveLocale", () => {
  it("prefers the saved choice", () => expect(resolveLocale("nl", "en-US,en;q=0.9")).toBe("nl"));
  it("reads Accept-Language by weight", () => expect(resolveLocale(undefined, "de;q=0.9,nl-NL;q=0.8,en;q=0.1")).toBe("nl"));
  it("falls back to English", () => expect(resolveLocale("fr", "fr-FR,de")).toBe("en"));
});

describe("fmt", () => {
  it("fills placeholders and keeps unknown ones visible", () => expect(fmt("{a} and {b}", { a: 1 })).toBe("1 and {b}"));
});

/** Every English key exists in Dutch with a non-empty string, and vice versa. */
function keys(o: unknown, prefix = ""): string[] {
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
function get(o: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], o);
}

describe("dictionaries", () => {
  it("English and Dutch have the same keys", () => expect(keys(dictionaries.nl).sort()).toEqual(keys(dictionaries.en).sort()));
  it("no empty strings", () => {
    for (const l of ["en", "nl"] as const) for (const k of keys(dictionaries[l])) expect(get(dictionaries[l], k), `${l}:${k}`).not.toBe("");
  });
  it("needs-review keys exist", () => {
    for (const k of NEEDS_REVIEW) expect(get(dictionaries.en, k), k).toBeTypeOf("string");
  });
});
