/**
 * Color-coded element status pill — teal (the brand's one accent color,
 * `--brand-teal-wash`/`--brand-teal-deep`, "pill/badge fills" per
 * design-handoff/cataco-brand-toolkit.md) for Confirmed, neutral for still
 * open. Deliberately not amber — the toolkit calls amber "a rare spark," not
 * a status color, and this badge appears on every open element everywhere.
 */
export function StatusBadge({ state, label }: { state: "locked" | "open"; label: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        state === "locked"
          ? "bg-brand-teal-wash text-brand-teal-deep"
          : "border border-brand-line text-brand-muted"
      }`}
    >
      {label}
    </span>
  );
}
