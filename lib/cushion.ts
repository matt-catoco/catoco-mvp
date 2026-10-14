/**
 * Price cushion at checkout (founder, 2026-10-14). Each participant picks how
 * much above their share they'll allow, in case the price moves before
 * booking; they're only ever charged the real amount (+ fee on that).
 *
 * The trip settings are complementary to this: "Let people add a price
 * cushion when they commit" switches the picker on, and the trip's (or the
 * element's) cushion value is the RECOMMENDED choice, pre-selected. Switch
 * off = no cushion anywhere. The fixed presets are placeholders until the
 * price-drift work settles them — change them here, nowhere else. The server
 * enforces the limits (funding_mandate_cushion_max: up to +50%, a custom
 * amount up to the share again, or the recommended cushion if that's larger).
 */
export const CUSHION_PRESET_PERCENTS = [5, 10];
export const CUSHION_MAX_PERCENT = 50;

export type CushionChoice =
  | { kind: "none" }
  | { kind: "percent"; value: number }
  | { kind: "amount"; value: number };

export type CushionOption = { key: string; label: string; choice: CushionChoice; recommended?: boolean };

/** No extra · the presets · the recommended cushion (merged in and marked). The picker adds Custom. */
export function cushionOptions(recommended: CushionChoice | null, formatAmount: (n: number) => string): CushionOption[] {
  const opts: CushionOption[] = [
    { key: "none", label: "No extra", choice: { kind: "none" }, recommended: recommended?.kind === "none" },
  ];
  const percents = [...CUSHION_PRESET_PERCENTS];
  if (recommended?.kind === "percent" && !percents.includes(recommended.value)) percents.push(recommended.value);
  for (const v of percents.sort((x, y) => x - y)) {
    opts.push({
      key: `p${v}`,
      label: `+${v}%`,
      choice: { kind: "percent", value: v },
      recommended: recommended?.kind === "percent" && recommended.value === v,
    });
  }
  if (recommended?.kind === "amount") {
    opts.push({ key: `a${recommended.value}`, label: `+${formatAmount(recommended.value)}`, choice: recommended, recommended: true });
  }
  return opts;
}

/** The trip/element cushion setting, read as the checkout recommendation. */
export function recommendedCushion(kind: string | null | undefined, value: number | null | undefined): CushionChoice | null {
  if (kind !== "percent" && kind !== "amount") return null;
  const v = Number(value ?? 0);
  if (!Number.isFinite(v) || v <= 0) return { kind: "none" };
  return { kind, value: v };
}

/** The most a participant could be charged for their share (before the fee). */
export function cushionCap(share: number, c: CushionChoice): number {
  if (c.kind === "percent") return Math.round(share * (1 + c.value / 100) * 100) / 100;
  if (c.kind === "amount") return Math.round((share + Math.max(0, c.value)) * 100) / 100;
  return share;
}

/** RPC args for create_funding_mandate / set_funding_mandate_cushion. */
export function cushionArgs(c: CushionChoice): { p_cushion_kind: string; p_cushion_value: number } {
  return c.kind === "none" ? { p_cushion_kind: "none", p_cushion_value: 0 } : { p_cushion_kind: c.kind, p_cushion_value: c.value };
}
