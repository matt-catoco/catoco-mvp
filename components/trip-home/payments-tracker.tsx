import Link from "next/link";
import { formatCurrency } from "@/lib/trip-elements";

/**
 * "Your payments" — per-participant tracker at the top of Trip Home
 * (founder spec 2026-10-10 + decisions 2026-10-11). Bar length = what this
 * person has committed to; fill = what's been captured from them ("Funded").
 * One tracker per currency — amounts are never summed across currencies.
 * Amounts include the Catoco fee, which is never shown separately here.
 * Bundled elements each get their own row. Only ever fed the viewer's OWN
 * figures (get_my_trip_payments).
 */
export type TrackerStatus = "funded" | "committed" | "failed";

export type TrackerRow = {
  key: string;
  symbol: string;
  label: string;
  /** what this person pays for it (share + Catoco fee) */
  amount: number;
  status: TrackerStatus;
};

export type TrackerFailure = { elementLabel: string; message: string; href: string };

const PILL: Record<TrackerStatus, { text: string; cls: string }> = {
  funded: { text: "Funded", cls: "border-brand-teal-deep text-brand-teal-deep" },
  committed: { text: "Committed", cls: "border-dashed border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep" },
  failed: { text: "Payment failed", cls: "border-[#D4402F] text-[#D4402F]" },
};

const HATCH = {
  background: "repeating-linear-gradient(135deg, var(--brand-teal-wash) 0 6px, rgb(0 0 0 / 0.05) 6px 12px)",
  boxShadow: "inset 0 0 0 1.5px var(--brand-teal-deep)",
};

const FAILED = {
  background: "repeating-linear-gradient(135deg, #FBE9E7 0 6px, rgb(212 64 47 / 0.12) 6px 12px)",
  boxShadow: "inset 0 0 0 1.5px #D4402F",
};

export function PaymentsTracker({
  currency,
  rows,
  failures = [],
}: {
  currency: string;
  rows: TrackerRow[];
  /** failed payments in this currency, with the retry-window wording */
  failures?: TrackerFailure[];
}) {
  const money = (n: number) => formatCurrency(n, currency);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const funded = rows.filter((r) => r.status === "funded").reduce((s, r) => s + r.amount, 0);
  const failed = rows.filter((r) => r.status === "failed").reduce((s, r) => s + r.amount, 0);
  const rest = Math.max(0, total - funded - failed);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const card = "flex w-full flex-col gap-3 rounded-2xl border-2 border-brand-line bg-background p-4 text-left";

  if (rows.length === 0) {
    return (
      <section className={card} aria-label="Your payments">
        <h2 className="font-[family-name:var(--font-display)] text-base font-bold">Your payments</h2>
        <div className="h-3.5 rounded-full bg-black/[.06] dark:bg-white/[.08]" role="img" aria-label="Nothing committed yet" />
        <p className="text-xs text-brand-muted">Nothing to pay yet. When you commit to an element, your share shows up here.</p>
      </section>
    );
  }

  return (
    <section className={card} aria-label={`Your payments (${currency})`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-[family-name:var(--font-display)] text-base font-bold">Your payments</h2>
        <span className="text-sm tabular-nums text-brand-muted">
          <b className="mr-1 font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{money(funded)}</b>
          funded of {money(total)} committed
        </span>
      </div>
      <div
        className="flex h-3.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"
        role="img"
        aria-label={`${money(funded)} funded of ${money(total)} committed${failed > 0 ? `, ${money(failed)} failed` : ""}`}
      >
        {funded > 0 && <div className="h-full bg-brand-teal-deep" style={{ width: `${pct(funded)}%` }} />}
        {rest > 0 && <div className="h-full" style={{ ...HATCH, width: `${pct(rest)}%` }} />}
        {failed > 0 && <div className="h-full" style={{ ...FAILED, width: `${pct(failed)}%` }} />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-brand-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-3 rounded bg-brand-teal-deep" aria-hidden />
          Funded {money(funded)}
        </span>
        {rest > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-3 rounded" style={HATCH} aria-hidden />
            Committed, not yet funded {money(rest)}
          </span>
        )}
        {failed > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-3 rounded" style={FAILED} aria-hidden />
            Payment failed {money(failed)}
          </span>
        )}
      </div>
      {failures.map((f) => (
        <p
          key={f.href}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          Your payment for <b>{f.elementLabel}</b> didn&apos;t go through — {f.message}{" "}
          <Link href={f.href} className="font-semibold underline">
            Fix it
          </Link>
        </p>
      ))}
      <details className="border-t border-brand-line pt-2.5">
        <summary className="cursor-pointer text-xs font-semibold text-brand-teal-deep">See the breakdown</summary>
        <ul className="mt-1.5 flex flex-col">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2.5 border-b border-brand-line py-2 text-[13px] last:border-0">
              <span className="grid size-7 place-items-center rounded-lg border border-brand-line font-[family-name:var(--font-display)] text-xs font-bold">
                {r.symbol}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{r.label}</span>
                <span className="block text-[11px] text-brand-muted">Your share</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">{money(r.amount)}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PILL[r.status].cls}`}>
                  {PILL[r.status].text}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
