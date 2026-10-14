import { SiteNav } from "@/components/site-nav";

// See app/trips/layout.tsx for why this exists per-subtree instead of in
// the root layout. Covers /profile.
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
