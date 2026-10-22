// Pledge-only collection (three-prong Prompt 1): pure helpers shared by
// server and client — IBAN checks, the SEPA payment QR payload, the share
// cap and the Book gate. Covered by lib/pledge.test.ts.

/** Shown on the accepted-terms record; bump when the terms text changes. */
// v2 (2026-10-22): no cushion — the share can't rise; pay timing is the organizer's choice.
export const PLEDGE_TERMS_VERSION = "pledge-v2";

/** "nl91 abna 0417 1643 00" → "NL91ABNA0417164300" */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** "NL91ABNA0417164300" → "NL91 ABNA 0417 1643 00" */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

/** ISO 13616: country + check digits + BBAN, mod-97 check equals 1. */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/**
 * EPC069-12 "SEPA credit transfer" QR payload (what Dutch and other EU
 * banking apps scan): name, IBAN, euro amount and an unstructured reference,
 * prefilled. EUR only — returns null for any other currency or a bad IBAN.
 */
export function epcQrPayload(opts: { name: string; iban: string; amount: number; currency: string; reference: string }): string | null {
  if (opts.currency.toUpperCase() !== "EUR") return null;
  if (!isValidIban(opts.iban)) return null;
  if (!(opts.amount >= 0.01 && opts.amount <= 999999999.99)) return null;
  const name = opts.name.trim().slice(0, 70);
  if (!name) return null;
  return [
    "BCD",
    "002", // version 002: BIC optional inside the EEA
    "1", // UTF-8
    "SCT",
    "", // BIC
    name,
    normalizeIban(opts.iban),
    `EUR${opts.amount.toFixed(2)}`,
    "", // purpose
    "", // structured reference (we use the unstructured line instead)
    opts.reference.slice(0, 140),
  ].join("\n");
}

/** The most a share can rise to under the pledge cap. */
export function capAmount(share: number, capPercent: number): number {
  return Math.round(share * (1 + capPercent / 100) * 100) / 100;
}

export type GateInput = {
  /** People in the element (spots-capped) who owe a share. */
  population: number;
  share: number;
  /** What each live pledger has paid (confirmed by the organizer). */
  paid: number[];
  /** The organizer chose to cover the gap and book anyway. */
  shortfallAccepted: boolean;
};

/**
 * Book unlocks when every person in has paid their full share, or the
 * organizer explicitly accepted the shortfall (they cover it; recorded).
 * Mirrors pledge_settle() / proceed_with_shortfall() in the database.
 */
export function bookUnlocked(g: GateInput): boolean {
  if (g.shortfallAccepted) return true;
  if (g.population <= 0) return false;
  return g.paid.filter((p) => p >= g.share).length >= g.population;
}

/** What's still missing for the whole booking. */
export function gapAmount(required: number, paid: number[]): number {
  return Math.max(0, Math.round((required - paid.reduce((a, b) => a + b, 0)) * 100) / 100);
}

/** When the pay window closes, or null while it hasn't opened or has no deadline. */
export function payWindowClosesAt(openedAt: string | null, hours: number | null): Date | null {
  if (!openedAt || hours == null) return null;
  return new Date(new Date(openedAt).getTime() + hours * 3_600_000);
}
