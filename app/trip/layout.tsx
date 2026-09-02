import { SiteNav } from "@/components/site-nav";

// See app/trips/layout.tsx for why this exists per-subtree instead of in
// the root layout. Covers /trip/[tripId]/join.
export default function TripLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
