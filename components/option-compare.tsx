import { DETAIL_ORDER, detailRows, readDetails } from "@/lib/option-details";
import { optionCost } from "@/lib/option-cost";
import { PRICE_BEARING_TYPES, formatCurrency, summarizeOptionValue, type ElementType } from "@/lib/trip-elements";
import { compareFields, optionThumbnail, optionTitle } from "@/components/option-summary";

type CompareOption = { id: string; value: Record<string, unknown>; votes: number };
type Cell = { text: string; best?: boolean; mine?: boolean; link?: string } | null;

const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

/**
 * Side-by-side comparison at the vote (founder, 2026-10-09; restyled
 * 2026-10-14 and 2026-10-17 to the "Voting and Compare" mockup): one column
 * per option — thumbnail and name on top, a deep-teal top edge on your vote
 * — and one row per attribute: Per person (lowest marked "best price"),
 * Total, the type's own fields (compareFields: Dates, Guests, Type… or a
 * Dining compare's cuisine and meal), then every detail the submission-time
 * pass found, Votes and the Listing. Rows nobody has a value for are
 * dropped. The label column stays put while the table scrolls sideways.
 */
export function OptionCompare({
  type,
  symbol,
  options,
  myVoteId,
  headcount,
  tripNights = null,
}: {
  type: ElementType;
  symbol: string;
  options: CompareOption[];
  myVoteId: string | null;
  /** opted-in people on the element — splits shared prices per person */
  headcount: number;
  tripNights?: number | null;
}) {
  const priced = PRICE_BEARING_TYPES.includes(type);
  const costs = options.map((o) => optionCost(o.value, headcount, tripNights));
  const perPeople = costs.map((c) => c.perPerson).filter((n): n is number => n != null);
  const lowest = perPeople.length > 1 ? Math.min(...perPeople) : null;
  const money = (n: number | null, currency: string) => (n == null ? null : formatCurrency(n, currency));

  const rows: { key: string; label: string; cells: Cell[] }[] = [];
  if (priced) {
    rows.push({
      key: "per_person",
      label: "Per person",
      cells: costs.map((c) => {
        const text = money(c.perPerson, c.currency);
        return text ? { text, best: lowest != null && c.perPerson === lowest } : null;
      }),
    });
    rows.push({
      key: "total",
      label: "Total",
      cells: costs.map((c) => {
        const text = money(c.total, c.currency);
        return text ? { text } : null;
      }),
    });
    const fieldsPer = options.map((o) => compareFields(type, o.value));
    for (const f of fieldsPer[0] ?? []) {
      rows.push({
        key: f.key,
        label: f.label,
        cells: fieldsPer.map((fs) => {
          const v = fs.find((x) => x.key === f.key)?.value;
          return v ? { text: v } : null;
        }),
      });
    }
  } else {
    rows.push({ key: "summary", label: "Summary", cells: options.map((o) => ({ text: summarizeOptionValue(type, o.value) })) });
  }

  const perOption = options.map((o) => new Map(detailRows(readDetails(o.value)).map((r) => [r.key, r])));
  const detailKeys: { key: string; label: string }[] = [];
  for (const m of perOption) {
    for (const r of m.values()) if (!detailKeys.some((k) => k.key === r.key)) detailKeys.push({ key: r.key, label: r.label });
  }
  const rank = (k: string) => (DETAIL_ORDER as readonly string[]).indexOf(k);
  detailKeys.sort((a, b) => rank(a.key) - rank(b.key));
  for (const k of detailKeys) {
    rows.push({
      key: `d:${k.key}`,
      label: k.label,
      cells: perOption.map((m) => {
        const v = m.get(k.key)?.value;
        return v ? { text: v } : null;
      }),
    });
  }

  rows.push({
    key: "votes",
    label: "Votes",
    cells: options.map((o) => ({ text: String(o.votes), mine: o.id === myVoteId })),
  });
  rows.push({
    key: "listing",
    label: "Listing",
    cells: options.map((o) => {
      const link = typeof o.value.booking_link === "string" ? o.value.booking_link.trim() : "";
      return link ? { text: "Open", link } : null;
    }),
  });

  const visible = rows.filter((r) => r.cells.some((c) => c && c.text.trim()));

  const sticky = "sticky left-0 z-10 w-[120px] min-w-[120px] bg-brand-surface px-3.5 text-left align-top text-[12.5px] font-medium text-brand-muted";
  const cell = "min-w-[150px] px-3.5 align-top";

  return (
    <div className="overflow-x-auto rounded-2xl border border-brand-line bg-brand-surface" role="region" aria-label="Compare options" tabIndex={0}>
      <table className="w-full min-w-[560px] border-collapse text-left text-[13.5px] tabular-nums">
        <thead>
          <tr className="border-b border-brand-line">
            <th scope="col" className={`${sticky} pb-2.5 pt-3.5`}>
              <span className="sr-only">Option</span>
            </th>
            {options.map((o) => {
              const thumb = optionThumbnail(type, o.value);
              const mine = o.id === myVoteId;
              return (
                <th
                  key={o.id}
                  scope="col"
                  className={`${cell} pb-2.5 pt-3.5 align-bottom font-normal ${mine ? "shadow-[inset_0_3px_0_var(--brand-accent)]" : ""}`}
                >
                  <span className="flex flex-col gap-2">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host
                      <img src={thumb} alt="" className="h-16 w-full rounded-[10px] bg-brand-line/50 object-cover" />
                    ) : (
                      <span
                        aria-hidden
                        className="grid h-16 w-full place-items-center rounded-[10px] bg-brand-line/40 font-[family-name:var(--font-display)] text-base font-bold text-brand-muted"
                      >
                        {symbol}
                      </span>
                    )}
                    <span className="line-clamp-2 font-[family-name:var(--font-display)] text-[15px] font-bold leading-tight text-foreground">
                      {optionTitle(type, o.value)}
                    </span>
                    {mine && <span className="sr-only">(your vote)</span>}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.key} className="border-b border-brand-line last:border-0">
              <th scope="row" className={`${sticky} py-2.5`}>
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td key={options[i].id} className={`${cell} whitespace-pre-line break-words py-2.5 text-foreground`}>
                  {!c ? (
                    <span className="text-brand-muted">—</span>
                  ) : c.link ? (
                    <a
                      href={c.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`rounded-sm text-[12.5px] font-semibold text-brand-accent ${focusRing}`}
                    >
                      Open<span className="sr-only"> listing for {optionTitle(type, options[i].value)} (opens in a new tab)</span>
                    </a>
                  ) : c.best ? (
                    <span className="inline-block rounded-md bg-brand-teal-wash px-2 py-0.5 font-bold text-brand-accent" title="Best price">
                      {c.text}
                      <span className="sr-only"> (best price)</span>
                    </span>
                  ) : (
                    <>
                      {c.text}
                      {c.mine && (
                        <span className="ml-1.5 rounded-full border border-brand-accent px-2 py-px text-[11.5px] font-semibold text-brand-accent">
                          Your vote
                        </span>
                      )}
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
