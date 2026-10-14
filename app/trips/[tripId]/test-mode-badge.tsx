/** "Test mode" badge — only against Stripe test keys (the same pk_test_ signal
 * that decides whether payments are configured at all). */
export const STRIPE_TEST_MODE = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");

export function TestModeBadge() {
  if (!STRIPE_TEST_MODE) return null;
  return (
    <span className="rounded-full border border-amber-500/40 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
      Test mode
    </span>
  );
}
