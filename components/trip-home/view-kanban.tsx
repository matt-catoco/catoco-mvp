import Link from "next/link";
import type { ElementTier } from "@/lib/trip-elements";
import type { OverviewElement } from "./types";

// Provisional/lower-priority per the design brief — a real, dedicated
// "Ready to Go" column instead of a status buried in a tile's corner, at
// the cost of being the newest, least-battle-tested of the four views.
// Column wording deliberately differs from Table's legend ("Confirmed" here
// vs "Locked" there, "Ready to Go" vs "Ready to go") — matches the mockup's
// own per-view copy, not a shared constant.
const KANBAN_COLUMNS: { tier: ElementTier; title: string }[] = [
  { tier: "open", title: "Open / Voting" },
  { tier: "locked", title: "Confirmed" },
  { tier: "funded", title: "Funded" },
  { tier: "ready", title: "Ready to Go" },
];

const CARD_CLASSES: Record<ElementTier, string> = {
  open: "border-dashed border-brand-line",
  locked: "border-dashed border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep",
  // Fixed paper, not `bg-background` — see element-tile.tsx's note: that
  // token flips to ink in dark mode and collides with `ready`'s own fixed
  // ink fill just below.
  funded: "border-brand-teal-deep bg-[#FAFAF7] text-brand-teal-deep",
  ready: "border-brand-teal bg-[#0D2020] text-[#FAFAF7]",
};

export function ViewKanban({ elements }: { elements: OverviewElement[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-brand-teal-deep md:hidden">
        ← Swipe to see all four stages →
      </p>
      <div className="-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-1 md:mx-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0">
        {KANBAN_COLUMNS.map(({ tier, title }) => {
          const items = elements.filter((el) => el.tier === tier);
          return (
            <div key={tier} className="w-[82%] flex-none snap-start md:w-auto">
              <div className="mb-2.5 flex items-center justify-between px-0.5">
                <span className="font-[family-name:var(--font-display)] text-sm font-bold text-foreground">
                  {title}
                </span>
                <span className="rounded-full border border-brand-line bg-background px-2 py-0.5 text-[11px] font-bold text-brand-muted">
                  {items.length}
                </span>
              </div>
              <div
                className={`min-h-[280px] rounded-2xl p-3 ${
                  tier === "ready" ? "bg-brand-teal-wash" : "bg-black/[.03] dark:bg-white/[.04]"
                }`}
              >
                {items.length === 0 ? (
                  <p className="p-1 text-xs italic text-brand-muted">Nothing here yet</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {items.map((el) => (
                      <Link
                        key={el.id}
                        href={el.href}
                        className={`block rounded-xl border-2 p-3 transition-opacity hover:opacity-90 ${CARD_CLASSES[el.tier]}`}
                      >
                        <div className="font-[family-name:var(--font-display)] text-base font-bold">
                          {el.symbol}
                        </div>
                        <div className="mt-1 text-xs font-semibold">{el.label}</div>
                        {el.detail && <div className="mt-0.5 text-[10.5px] opacity-70">{el.detail}</div>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
