// Exact markup from design-handoff/cataco-mark.svg (the finalized "Element
// Tile" mark) — public/brand/cataco-mark.svg is the same file, kept there
// for any future non-inline use (dark/mono variants live alongside it).
// Shared between the homepage and the site nav — moved here once it needed
// a second caller, same reasoning as components/element-value-fields.tsx.
export function LogoMark() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden>
      <rect width="512" height="512" rx="113" fill="#2DD4BF" />
      <rect
        x="77"
        y="77"
        width="358"
        height="358"
        rx="61"
        fill="none"
        stroke="#0D2020"
        strokeWidth="15"
        strokeDasharray="15,20"
      />
      <rect
        x="184"
        y="184"
        width="144"
        height="144"
        rx="31"
        fill="#0D2020"
        transform="rotate(45 256 256)"
      />
    </svg>
  );
}
