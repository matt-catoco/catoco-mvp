// Shared brand-consistent Tailwind class strings for form controls, mirroring
// the homepage's own .btnPrimary/.btnGhost/.wrap patterns (page.module.css)
// so the voting/funding/element screens stop looking like the generic
// Tailwind default and start looking like the same product as the homepage
// and the Trip Home tile grid (which already use these brand tokens via
// ElementTile/StatusBadge). Sizing (height, padding) stays per call site --
// this only centralizes color/border/hover treatment, not layout.

// Solid ink, paper text, hovers to teal-deep -- exactly page.module.css's
// .btnPrimary. For primary actions: Submit, Add, Mark booked, Save.
export const btnPrimary =
  "rounded-lg bg-foreground text-background font-medium transition-colors hover:bg-brand-teal-deep disabled:opacity-40";

// Outlined with the brand line color, border darkens on hover -- exactly
// page.module.css's .btnGhost. For secondary/lower-stakes actions: Cancel,
// Set deadline, Resolve.
export const btnSecondary =
  "rounded-lg border border-brand-line text-foreground font-medium transition-colors hover:border-foreground disabled:opacity-40";

// Text inputs/selects across the element and funding forms.
export const fieldClass =
  "w-full rounded-lg border border-brand-line bg-transparent px-3 text-sm outline-none focus:border-brand-teal-deep";

// Field labels and other secondary/caption text.
export const labelClass = "text-xs font-medium text-brand-muted";

// Inactive state for pill-style toggle buttons (active state stays
// bg-foreground text-background, same solid-ink treatment as btnPrimary).
export const pillInactive =
  "border-brand-line text-brand-muted hover:bg-brand-teal-wash hover:text-brand-teal-deep";
