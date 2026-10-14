import { DETAIL_ORDER, detailRows, readDetails } from "@/lib/option-details";
import { PRICE_BEARING_TYPES, summarizeOptionValue, type ElementType } from "@/lib/trip-elements";
import { compareFields, optionThumbnail, optionTitle, priceWithBasis } from "@/components/option-summary";

type CompareOption = { id: string; value: Record<string, unknown> };

/**
 * Side-by-side comparison at the vote (founder, 2026-10-09; restyled to
 * match the element cards 2026-10-14): one column per option — thumbnail
 * and name on top — one row per thing worth comparing. Rows come from the
 * fields the options actually have (compareFields), then every detail the
 * submission-time pass found; rows nobody has are dropped and a dash means
 * that listing didn't say. The lowest price among options priced the same
 * way gets a teal-wash marker; the viewer's first choice gets "Your vote".
 * The first column stays put while the table scrolls sideways in its own
 * container.
 */
export function OptionCompare({
  type,
  symbol,
  options,
  myVoteId,
}: {
  type: ElementType;
  symbol: string;
  options: CompareOption[];
  myVoteId: string | null;
}) {
  // Lowest price, only among options priced on the same basis (comparing a
  // per-night price with a per-person one would be meaningless).
  const priced = options.map((o) => {
    const n = Number(o.value.price);
    const ok = o.value.price !== undefined && o.value.price !== "" && Number.isFinite(n);
    return ok ? { id: o.id, n, basis: String(o.value.pricing_basis ?? "") } : null;
  });
  const byBasis = new Map<string, { id: string; n: number }[]>();
  for (const p of priced) if (p) byBasis.set(p.basis, [...(byBasis.get(p.basis) ?? []), p]);
  const largest = [...byBasis.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const lowestId = largest.length > 1 ? largest.reduce((m, p) => (p.n < m.n ? p : m)).id : null;

  const perOption = options.map((o) => new Map(detailRows(readDetails(o.value)).map((r) => [r.key, r])));
  const detailKeys: { key: string; label: string }[] = [];
  for (const m of perOption) {
    for (const r of m.values()) if (!detailKeys.some((k) => k.key === r.key)) detailKeys.push({ key: r.key, label: r.label });
  }
  const rank = (k: string) => (DETAIL_ORDER as readonly string[]).indexOf(k);
  detailKeys.sort((a, b) => rank(a.key) - rank(b.key));

  const rows: { key: string; label: string; cells: (string | null)[]; price?: boolean }[] = [];
  if (PRICE_BEARING_TYPES.includes(type)) {
    rows.push({ key: "price", label: "Price", cells: options.map((o) => {
      const p = priceWithBasis(o.value);
      return p ? `${p.amount}${p.basis ? ` ${p.basis}` : ""}` : null;
    }), price: true });
    const fieldsPer = options.map((o) => compareFields(type, o.value));
    for (const f of fieldsPer[0] ?? []) {
      rows.push({ key: f.key, label: f.label, cells: fieldsPer.map((fs) => fs.find((x) => x.key === f.key)?.value ?? null) });
    }
  } else {
    rows.push({ key: "summary", label: "Summary", cells: options.map((o) => summarizeOptionValue(type, o.value)) });
  }
  for (const k of detailKeys) {
    rows.push({ key: `d:${k.key}`, label: k.label, cells: perOption.map((m) => m.get(k.key)?.value ?? null) });
  }
  const visible = rows.filter((r) => r.cells.some((c) => c && c.trim()));

  const sticky = "sticky left-0 z-10 w-28 min-w-28 bg-background px-3 text-left align-top font-medium text-brand-muted";
  const cell = "w-56 min-w-56 max-w-56 px-3 align-top";

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-line" role="region" aria-label="Compare options" tabIndex={0}>
      <table className="w-full min-w-max border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-brand-line">
            <th scope="col" className={`${sticky} py-3`}>
              <span className="sr-only">Option</span>
            </th>
            {options.map((o) => {
              const thumb = optionThumbnail(type, o.value);
              return (
                <th key={o.id} scope="col" className={`${cell} py-3 font-normal`}>
                  <span className="flex flex-col gap-2">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host
                      <img src={thumb} alt="" className="h-24 w-full rounded-lg bg-brand-line/50 object-cover" />
                    ) : (
                      <span
                        aria-hidden
                        className="grid h-24 w-full place-items-center rounded-lg bg-brand-line/40 font-[family-name:var(--font-display)] text-lg font-bold text-brand-muted"
                      >
                        {symbol}
                      </span>
                    )}
                    <span className="line-clamp-2 font-[family-name:var(--font-display)] text-[15px] font-bold leading-tight text-foreground">
                      {optionTitle(type, o.value)}
                    </span>
                    {o.id === myVoteId && (
                      <span className="w-fit rounded-full border border-brand-accent bg-brand-teal-wash px-2 py-0.5 text-[11px] font-semibold text-brand-accent">
                        Your vote
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.key} className="border-b border-brand-line/70 last:border-0">
              <th scope="row" className={`${sticky} py-3`}>
                {r.label}
              </th>
              {r.cells.map((c, i) => {
                const lowest = r.price && options[i].id === lowestId;
                return (
                  <td
                    key={options[i].id}
                    className={`${cell} whitespace-pre-line break-words py-3 ${lowest ? "bg-brand-teal-wash font-semibold text-foreground" : ""}`}
                  >
                    {c ?? <span className="text-brand-muted">—</span>}
                    {lowest && (
                      <span className="ml-1.5 rounded-full border border-brand-accent px-1.5 py-px text-[10px] font-semibold text-brand-accent">
                        Lowest
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className={`${sticky} py-3`}>
              Listing
            </th>
            {options.map((o) => {
              const link = typeof o.value.booking_link === "string" ? o.value.booking_link.trim() : "";
              return (
                <td key={o.id} className={`${cell} py-3`}>
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-sm font-semibold text-brand-accent underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                    >
                      Open listing ↗
                    </a>
                  ) : (
                    <span className="text-brand-muted">—</span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
