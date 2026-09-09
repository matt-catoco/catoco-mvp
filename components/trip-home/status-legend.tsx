import type { ElementTier } from "@/lib/trip-elements";

const LEGEND_ITEMS: { tier: ElementTier; label: string }[] = [
  { tier: "ready", label: "Ready to go" },
  { tier: "funded", label: "Funded" },
  { tier: "locked", label: "Locked" },
  { tier: "open", label: "Open" },
];

const DOT_CLASSES: Record<ElementTier, string> = {
  ready: "border-brand-teal bg-[#0D2020]",
  funded: "border-brand-teal-deep bg-background",
  locked: "border-brand-teal-deep bg-brand-teal-wash",
  open: "border-brand-line bg-background",
};

/** The shared open/locked/funded/ready key — Table's legend row, reused
 * as-is by Kanban's own read of the same four buckets. */
export function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-4 border-t border-brand-line pt-4 text-xs font-medium text-brand-muted">
      {LEGEND_ITEMS.map(({ tier, label }) => (
        <span key={tier} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full border-2 ${DOT_CLASSES[tier]}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
