import Link from "next/link";
import { ELEMENT_SYMBOLS, formatCurrency, type ElementType } from "@/lib/trip-elements";

/**
 * Organizer-only trip payments (founder spec 2026-10-10; trimmed to Needed /
 * Committed 2026-10-11). Per element in funding: what it needs and what the
 * group has committed (card holds, bank mandates and money already
 * collected). Vendor-side amounts — shares WITHOUT the Catoco fee. One table
 * per currency.
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
      <p className="rounded-xl border border-brand-line p-4 text-sm text-brand-muted">
        Nothing is collecting yet. Once an element is locked and opens for funding, it shows up here.
      </p>
    );
  }
  const byCurrency = new Map<string, SummaryRow[]>();
  for (const r of rows) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r]);

  return (
    <div className="flex flex-col gap-4">
      {[...byCurrency].map(([currency, list]) => {
        const money = (n: number) => formatCurrency(n, currency);
        const needed = list.reduce((s, r) => s + Number(r.required), 0);
        const committed = list.reduce((s, r) => s + Number(r.committed), 0);
        return (
          <section key={currency} className="rounded-xl border border-brand-line px-4 py-2" aria-label={`Payments in ${currency}`}>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-brand-line text-[11px] uppercase tracking-wide text-brand-muted">
                  <th className="py-2 font-semibold">Element</th>
                  <th className="py-2 text-right font-semibold">Needed</th>
                  <th className="py-2 text-right font-semibold">Committed</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.element_id} className="border-b border-brand-line">
                    <td className="py-2">
                      <Link href={`/trips/${tripId}/elements/${r.element_id}`} className="flex items-center gap-2 hover:underline">
                        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-brand-line text-[10px] font-bold">
                          {ELEMENT_SYMBOLS[r.element_type]}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.element_label}</span>
                          <span className="block text-[11px] text-brand-muted">
                            {r.n_committed === 0 ? "No one committed yet" : `${r.n_committed} committed`}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(Number(r.required))}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{money(Number(r.committed))}</td>
                  </tr>
                ))}
              </tbody>
              {list.length > 1 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right tabular-nums">{money(needed)}</td>
                    <td className="py-2 text-right tabular-nums">{money(committed)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
        );
      })}
      <p className="text-xs text-brand-muted">Amounts are the group&apos;s shares, before the Catoco fee.</p>
    </div>
  );
}
