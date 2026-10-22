/**
 * The info pages are hidden on the live production site and visible
 * everywhere else. A deployment counts as "production" when Vercel says so AND
 * it was built from a branch other than `staging` (so staging still shows
 * them even if it happens to be configured as a production-type deployment).
 */
// Live everywhere, even where the rest of the info pages are hidden.
const ALWAYS_PUBLIC = new Set(["/", "/about", "/contact", "/sign-in"]);

/** Whether this page is public on catoco.co (the rest are drafts shown on staging only). */
export function liveOnProduction(href: string): boolean {
  return ALWAYS_PUBLIC.has(href);
}

/** Whether a link to this path should show here (hides links to hidden pages). */
export function infoLinkVisible(href: string): boolean {
  return ALWAYS_PUBLIC.has(href) || !infoPagesHidden();
}

export function infoPagesHidden(): boolean {
  return (
    process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_GIT_COMMIT_REF !== "staging"
  );
}
