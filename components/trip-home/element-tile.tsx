import Link from "next/link";
import type { ReactNode } from "react";

export type ElementTileProps = {
  symbol: string;
  label: string;
  num: string;
  state: "locked" | "open";
  /** Only meaningful when state === "locked" — a locked-but-not-yet-funded
   * element renders as "Confirmed" (dashed teal), a funded one as the
   * strongest, solid-fill state. Mirrors the homepage hero mockup's 3-item
   * key: open/still voting -> confirmed/locked in by the group -> funded/
   * ready to go. No real funding mechanism exists behind this yet. */
  funded?: boolean;
  statusLabel: string;
  detail?: string;
  href?: string;
  /**
   * The homepage's element-showcase section is a forced-dark "ink" panel
   * regardless of system light/dark mode (a page-scoped design choice, not
   * the same axis as Tailwind's `dark:` variant) — this swaps to the
   * hardcoded paper/ink pairing that section relies on for contrast. Trip
   * Home tiles (the default) instead track the ambient background/
   * foreground tokens, which already flip with system theme.
   */
  onDark?: boolean;
};

/**
 * One Trip Home tile — shared between the real dashboard (app/trips/[tripId])
 * and the homepage's demo showcase (app/page.tsx), per the 2026-08-31 decision
 * to build this once rather than maintain two hand-built copies of the same
 * dashed-vs-solid device (design-handoff/catoco-brand-toolkit.md: dashed
 * outline = open/still deciding, solid fill = locked in by the group) — now
 * a 3-way progression: dashed neutral (open) -> dashed teal (confirmed) ->
 * solid (funded).
 */
export function ElementTile({
  symbol,
  label,
  num,
  state,
  funded = false,
  statusLabel,
  detail,
  href,
  onDark = false,
}: ElementTileProps) {
  const fundedClasses = onDark
    ? "bg-[#FAFAF7] text-[#0D2020] border-brand-teal"
    : "bg-background text-foreground border-brand-teal";
  const confirmedClasses = onDark
    ? "border-dashed border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep"
    : "border-dashed border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep";
  const openClasses = onDark
    ? "border-dashed border-white/35 text-white/85"
    : "border-dashed border-brand-line text-foreground";

  const variantClasses =
    state === "locked" ? (funded ? fundedClasses : confirmedClasses) : openClasses;

  const tileClasses = [
    "flex min-h-[128px] flex-col justify-between rounded-2xl border-2 p-5 text-left transition-colors",
    variantClasses,
    href ? "hover:border-brand-teal-deep cursor-pointer" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner: ReactNode = (
    <>
      <span className="text-[11px] font-semibold opacity-55">{num}</span>
      <span className="my-1.5 font-[family-name:var(--font-display)] text-2xl font-bold">
        {symbol}
      </span>
      <span className="text-xs font-semibold">{label}</span>
      <span className="mt-2.5 text-[10.5px] opacity-70">
        {statusLabel}
        {detail ? ` — ${detail}` : ""}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={tileClasses}>
        {inner}
      </Link>
    );
  }

  return <div className={tileClasses}>{inner}</div>;
}
