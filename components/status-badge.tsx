/**
 * Color-coded element status pill — mirrors the homepage hero mockup's
 * 3-item key: neutral (Collecting ideas) -> teal-wash/teal-deep (Confirmed
 * — the toolkit's own "pill/badge fills" color, design-handoff/
 * catoco-brand-toolkit.md) -> solid teal (Funded, the strongest state).
 * Deliberately not amber for any of these — the toolkit calls amber "a rare
 * spark," not a status color, and these badges are on every element.
 */
export function StatusBadge({
  state,
  label,
}: {
  state: "open" | "locked" | "funded";
  label: string;
}) {
  const classes =
    state === "funded"
      ? "bg-brand-teal text-[#0D2020]"
      : state === "locked"
        ? "bg-brand-teal-wash text-brand-teal-deep"
        : "border border-brand-line text-brand-muted";

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${classes}`}
    >
      {label}
    </span>
  );
}
