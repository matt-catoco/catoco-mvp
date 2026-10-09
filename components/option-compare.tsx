import { DETAIL_ORDER, detailRows, readDetails } from "@/lib/option-details";
import { PRICE_BEARING_TYPES, summarizeOptionValue, type ElementType } from "@/lib/trip-elements";
import { keyFactsLine, priceLine } from "@/components/option-summary";

type CompareOption = { id: string; value: Record<string, unknown>; groupRank: number };

/**
 * Side-by-side comparison at the vote (founder, 2026-10-09): one column per
 * option, one row per thing worth comparing — price, the key facts already
 * on the cards, then every detail the submission-time pass found (rating,
 * cancellation, check-in, what's included…). Rows nobody has are dropped;
 * a blank cell means that listing didn't say. Scrolls sideways on phones.
 */
export function OptionCompare({ type, options }: { type: ElementType; options: CompareOption[] }) {
  const title = (v: Record<string, unknown>) =>
    (typeof v.title === "string" && v.title.trim()) || (typeof v.name === "string" && v.name.trim()) || summarizeOptionValue(type, v);

  const prices = options.map((o) => {
    const n = Number(o.value.price);
    return o.value.price !== undefined && o.value.price !== "" && Number.isFinite(n) ? n : null;
  });
  const known = prices.filter((p): p is number => p !== null);
  const cheapest = known.length > 1 ? Math.min(...known) : null;

  const perOption = options.map((o) => new Map(detailRows(readDetails(o.value)).map((r) => [r.key, r])));
  const detailKeys: { key: string; label: string }[] = [];
  for (const m of perOption) {
    for (const r of m.values()) if (!detailKeys.some((k) => k.key === r.key)) detailKeys.push({ key: r.key, label: r.label });
  }
  // canonical order regardless of which option had what first
  const rank = (k: string) => (DETAIL_ORDER as readonly string[]).indexOf(k);
  detailKeys.sort((a, b) => rank(a.key) - rank(b.key));

  const rows: { label: string; cells: (string | null)[]; highlight?: (number | null)[] }[] = [];
  if (PRICE_BEARING_TYPES.includes(type)) {
    rows.push({ label: "Price", cells: options.map((o) => priceLine(o.value)), highlight: prices });
    rows.push({ label: "Key facts", cells: options.map((o) => keyFactsLine(type, o.value)) });
  } else {
    rows.push({ label: "Summary", cells: options.map((o) => summarizeOptionValue(type, o.value)) });
  }
  for (const k of detailKeys) {
    rows.push({ label: k.label, cells: perOption.map((m) => m.get(k.key)?.value ?? null) });
  }
  const visible = rows.filter((r) => r.cells.some((c) => c && c.trim()));

  return (
    <div className="overflow-x-auto rounded-lg border border-brand-line">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-brand-line align-bottom">
            <th className="sticky left-0 z-10 w-28 bg-background p-2 font-medium text-brand-muted" />
            {options.map((o) => (
              <th key={o.id} className="w-52 max-w-52 p-2 align-top font-semibold">
                <span className="block text-[10px] font-medium text-brand-muted">#{o.groupRank} overall</span>
                <span className="line-clamp-2">{title(o.value)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.label} className="border-b border-brand-line/60 align-top last:border-0">
              <th className="sticky left-0 z-10 w-28 bg-background p-2 font-medium text-brand-muted">{r.label}</th>
              {r.cells.map((c, i) => (
                <td
                  key={options[i].id}
                  className={`w-52 max-w-52 whitespace-pre-line break-words p-2 ${
                    r.highlight && cheapest !== null && r.highlight[i] === cheapest ? "font-semibold text-brand-teal-deep" : ""
                  }`}
                >
                  {c ?? <span className="text-brand-muted">—</span>}
                  {r.highlight && cheapest !== null && r.highlight[i] === cheapest && (
                    <span className="ml-1 text-[10px] font-medium">lowest</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
          <tr className="align-top">
            <th className="sticky left-0 z-10 w-28 bg-background p-2 font-medium text-brand-muted">Listing</th>
            {options.map((o) => {
              const link = typeof o.value.booking_link === "string" ? o.value.booking_link.trim() : "";
              return (
                <td key={o.id} className="w-52 max-w-52 p-2">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-teal-deep underline">
                      Open ↗
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
