import { ElementGrid } from "./element-grid";
import { StatusLegend } from "./status-legend";
import { TIER_ORDER, type OverviewElement } from "./types";

/**
 * The original tile grid, reordered by status (2026-09-xx "Trip overview —
 * view options"): Ready to go, then Funded, then Locked, then Open — a
 * stable sort, so within a tier elements keep their creation order. Same
 * tiles as before; only the ordering and the legend row are new.
 */
export function ViewTable({ elements }: { elements: OverviewElement[] }) {
  const sorted = [...elements].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

  return (
    <div className="flex flex-col gap-5">
      <ElementGrid
        tiles={sorted.map((el) => ({
          key: el.id,
          symbol: el.symbol,
          label: el.label,
          num: el.num,
          tier: el.tier,
          statusLabel: el.statusLabel,
          detail: el.detail,
          href: el.href,
        }))}
      />
      <StatusLegend />
    </div>
  );
}
