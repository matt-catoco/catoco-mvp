/**
 * The info pages are hidden on the live production site and visible
 * everywhere else. A deployment counts as "production" when Vercel says so AND
 * it was built from a branch other than `staging` (so staging still shows
 * them even if it happens to be configured as a production-type deployment).
 */
export function infoPagesHidden(): boolean {
  return (
    process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_GIT_COMMIT_REF !== "staging"
  );
}
