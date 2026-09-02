import { SiteNav } from "@/components/site-nav";

// See app/trips/layout.tsx for why this exists per-subtree instead of in
// the root layout. Covers /onboarding/profile.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
