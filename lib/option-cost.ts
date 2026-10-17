import { nightsBetween } from "./trip-elements";

/**
 * Per-person and total for an option at the vote (voting restyle,
 * 2026-10-17), mirroring calculate_required_amount: per person × people,
 * per night × nights (the option's own dates, else the trip's), flat as is.
 * Headcount is the element's opted-in people. Display only — the share that
 * gets committed is still computed by the database at lock time.
 */
export function optionNights(value: Record<string, unknown>): number | null {
  const n = Number(value.nights);
  if (value.nights !== undefined && value.nights !== "" && Number.isFinite(n) && n >= 0) return n;
  const dates = (value.dates ?? {}) as Record<string, unknown>;
  const s = String(dates.start_date ?? value.start_date ?? "").slice(0, 10);
  const e = String(dates.end_date ?? value.end_date ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && /^\d{4}-\d{2}-\d{2}$/.test(e)) return nightsBetween(s, e);
  const ps = Date.parse(String(value.pickup_datetime ?? ""));
  const pe = Date.parse(String(value.dropoff_datetime ?? ""));
  if (Number.isFinite(ps) && Number.isFinite(pe) && pe > ps) return Math.max(1, Math.ceil((pe - ps) / 86_400_000));
  return null;
}

export function optionCost(
  value: Record<string, unknown>,
  headcount: number,
  tripNights: number | null = null,
): { perPerson: number | null; total: number | null; currency: string } {
  const currency = typeof value.currency === "string" && value.currency ? value.currency : "USD";
  const raw = value.price;
  const price = Number(raw);
  if (raw === undefined || raw === null || String(raw).trim() === "" || !Number.isFinite(price)) {
    return { perPerson: null, total: null, currency };
  }
  const people = headcount > 0 ? headcount : null;
  const round = (x: number) => Math.round(x * 100) / 100;
  switch (value.pricing_basis) {
    case "per_person":
      return { perPerson: price, total: people ? round(price * people) : null, currency };
    case "per_night": {
      const nights = optionNights(value) ?? tripNights;
      const total = nights != null ? round(price * nights) : null;
      return { perPerson: total != null && people ? round(total / people) : null, total, currency };
    }
    default:
      return { perPerson: people ? round(price / people) : null, total: price, currency };
  }
}
