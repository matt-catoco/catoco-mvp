import { SiteNav } from "@/components/site-nav";

// SiteNav moved out of the root layout (2026-09-02) — the homepage got its
// own auth-aware header instead of stacking a second, differently-themed
// bar on top of it. Every other route still wants the persistent nav, so
// it's added back at the route-subtree level instead. This one covers
// /trips and everything nested under it (new/[tripId]/add-element/
// elements/[elementId]/participants) via Next.js's layout cascade.
export default function TripsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
