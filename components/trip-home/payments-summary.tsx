import Link from "next/link";
import { ELEMENT_SYMBOLS, formatCurrency, type ElementType } from "@/lib/trip-elements";

/**
 * Organizer-only trip payments (founder spec 2026-10-10). Per element:
 * what it needs, what's been committed, what's been funded (captured), and
 * what's gone to the vendor. Vendor-side amounts — shares WITHOUT the Catoco
 * fee — so the columns compare like for like. One table per currency.
 */
export type SummaryRow = {
  element_id: string;
  element_type: ElementType;
  element_label: string;
  currency: string;
  required: number;
  committed: number;
  captured: number;
  paid_to_vendor: number | null;
  n_committed: number;
  n_funded: number;
};

export function PaymentsSummary({ tripId, rows }: { tripId: string; rows: SummaryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border-2 border-brand-line p-4 text-sm text-brand-muted">
        Nothing is collecting yet. Once an element opens for funding, its numbers show up here.
      </p>
    );
  }
  const byCurrency = new Map<string, SummaryRow[]>();
  for (const r of rows) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r]);

  return (
    <div className="flex flex-col gap-6">
      {[...byCurrency].map(([currency, list]) => {
        const money = (n: number) => formatCurrency(n, currency);
        const sum = (k: "required" | "committed" | "captured") => list.reduce((s, r) => s + Number(r[k]), 0);
        const vendor = list.reduce((s, r) => s + Number(r.paid_to_vendor ?? 0), 0);
        const required = sum("required");
        const committed = sum("committed");
        const captured = sum("captured");
        return (
          <section key={currency} className="rounded-2xl border-2 border-brand-line p-4" aria-label={`Payments in ${currency}`}>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Needed", required],
                ["Committed", committed],
                ["Funded", captured],
                ["Paid to vendors", vendor],
              ].map(([label, n]) => (
                <div key={label as string} className="rounded-xl bg-black/[.03] px-3 py-2 dark:bg-white/[.04]">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">{label}</div>
                  <div className="whitespace-nowrap font-[family-name:var(--font-display)] text-base font-bold tabular-nums">{money(n as number)}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-brand-line text-[11px] uppercase tracking-wide text-brand-muted">
                    <th className="py-2 font-semibold">Element</th>
                    <th className="py-2 text-right font-semibold">Needed</th>
                    <th className="py-2 text-right font-semibold">Committed</th>
                    <th className="py-2 text-right font-semibold">Funded</th>
                    <th className="py-2 text-right font-semibold">To vendor</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.element_id} className="border-b border-brand-line last:border-0">
                      <td className="py-2">
                        <Link href={`/trips/${tripId}/elements/${r.element_id}`} className="flex items-center gap-2 hover:underline">
                          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-brand-line font-[family-name:var(--font-display)] text-xs font-bold">
                            {ELEMENT_SYMBOLS[r.element_type]}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{r.element_label}</span>
                            <span className="block text-[11px] text-brand-muted">
                              {r.n_committed === 0 ? "No one committed yet" : `${r.n_funded} of ${r.n_committed} funded`}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="py-2 text-right tabular-nums">{money(Number(r.required))}</td>
                      <td className="py-2 text-right tabular-nums">{money(Number(r.committed))}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{money(Number(r.captured))}</td>
                      <td className="py-2 text-right tabular-nums text-brand-muted">
                        {r.paid_to_vendor != null ? money(Number(r.paid_to_vendor)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="text-xs text-brand-muted">
        Amounts are the group&apos;s shares, before the Catoco fee. Funded means the money has been collected; committed
        includes card holds and bank mandates that haven&apos;t been collected yet.
      </p>
    </div>
  );
}
