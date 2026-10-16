import Link from "next/link";
import { formatCurrency } from "@/lib/trip-elements";

/**
 * "Your payments" — compact per-participant tracker at the top of Trip Home
 * (founder spec 2026-10-10 + decisions 2026-10-11; made smaller 2026-10-11).
 * One line + thin bar per currency — amounts are never summed across
 * currencies. Fill = captured ("Funded"), hatched = committed, not yet
 * funded. Amounts include the Catoco fee, which is never shown separately.
 * Bundled elements each get their own breakdown row. Only ever fed the
 * viewer's OWN figures (get_my_trip_payments). Renders nothing until the
 * viewer has committed to something.
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

export type TrackerGroup = { currency: string; rows: TrackerRow[]; failures: TrackerFailure[] };

const PILL: Record<TrackerStatus, { text: string; cls: string }> = {
  funded: { text: "Funded", cls: "border-brand-teal-deep text-brand-teal-deep" },
  committed: { text: "Committed", cls: "border-dashed border-brand-accent bg-brand-teal-wash text-brand-accent" },
  failed: { text: "Failed", cls: "border-[#D4402F] text-[#D4402F]" },
};

const HATCH = {
  background: "repeating-linear-gradient(135deg, var(--brand-teal-wash) 0 4px, rgb(0 0 0 / 0.05) 4px 8px)",
  boxShadow: "inset 0 0 0 1px var(--brand-teal-deep)",
};

const FAILED = {
  background: "repeating-linear-gradient(135deg, #FBE9E7 0 4px, rgb(212 64 47 / 0.12) 4px 8px)",
  boxShadow: "inset 0 0 0 1px #D4402F",
};

function CurrencyLine({ currency, rows }: { currency: string; rows: TrackerRow[] }) {
  const money = (n: number) => formatCurrency(n, currency);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const funded = rows.filter((r) => r.status === "funded").reduce((s, r) => s + r.amount, 0);
  const failed = rows.filter((r) => r.status === "failed").reduce((s, r) => s + r.amount, 0);
  const rest = Math.max(0, total - funded - failed);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 text-[13px] tabular-nums text-brand-muted">
        <b className="font-semibold text-foreground">{money(funded)}</b> funded of {money(total)}
        {failed > 0 && <span className="text-[#D4402F]"> · {money(failed)} failed</span>}
      </span>
      <div
        className="flex h-2 w-full min-w-0 shrink-0 overflow-hidden rounded-full sm:w-auto sm:flex-1 bg-black/[.06] dark:bg-white/[.08]"
        role="img"
        aria-label={`${money(funded)} funded of ${money(total)} committed${failed > 0 ? `, ${money(failed)} failed` : ""}`}
      >
        {funded > 0 && <div className="h-full bg-brand-teal-deep" style={{ width: `${pct(funded)}%` }} />}
        {rest > 0 && <div className="h-full" style={{ ...HATCH, width: `${pct(rest)}%` }} />}
        {failed > 0 && <div className="h-full" style={{ ...FAILED, width: `${pct(failed)}%` }} />}
      </div>
    </div>
  );
}

export function PaymentsTracker({ groups }: { groups: TrackerGroup[] }) {
  const live = groups.filter((g) => g.rows.length > 0);
  if (live.length === 0) return null;
  const failures = live.flatMap((g) => g.failures);

  return (
    <section
      className="flex w-full flex-col gap-2 rounded-xl border border-brand-line bg-background px-3.5 py-2.5 text-left"
      aria-label="Your payments"
    >
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-1.5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-muted">Your payments</h2>
            <span className="text-[11px] font-semibold text-brand-teal-deep">
              <span className="group-open:hidden">Breakdown ▸</span>
              <span className="hidden group-open:inline">Hide ▾</span>
            </span>
          </span>
          {live.map((g) => (
            <CurrencyLine key={g.currency} currency={g.currency} rows={g.rows} />
          ))}
        </summary>
        <ul className="mt-2 flex flex-col border-t border-brand-line pt-1">
          {live.flatMap((g) =>
            g.rows.map((r) => (
              <li key={r.key} className="flex items-center gap-2.5 py-1.5 text-[13px]">
                <span className="grid size-6 shrink-0 place-items-center rounded-md border border-brand-line text-[10px] font-bold">
                  {r.symbol}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(r.amount, g.currency)}</span>
                <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${PILL[r.status].cls}`}>
                  {PILL[r.status].text}
                </span>
              </li>
            )),
          )}
        </ul>
      </details>
      {failures.map((f) => (
        <p
          key={f.href}
          className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          Your payment for <b>{f.elementLabel}</b> didn&apos;t go through — {f.message}{" "}
          <Link href={f.href} className="font-semibold underline">
            Fix it
          </Link>
        </p>
      ))}
    </section>
  );
}
