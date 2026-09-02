import { SiteNav } from "@/components/site-nav";

// See app/trips/layout.tsx for why this exists per-subtree instead of in
// the root layout. Covers /sign-in and /sign-in/check-email.
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
