import type { Metadata } from "next";
import { InfoFooter, InfoHeader } from "@/components/info/info-shell";

// HIDDEN ON PRODUCTION, page by page: Help, Terms, Privacy and Tutorials each
// return a 404 on the production deployment (their own notFound() guard) and
// inherit this layout's noindex. Contact (2026-10-15) and About (2026-10-19)
// are live: no guard, and their own robots override. The old Company page is gone;
// company details live on /about. Staging and
// preview deployments render everything. To launch a page: delete its guard
// and give it its own robots. The rule lives in components/info/visibility.ts.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function InfoLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <InfoHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-14">{children}</main>
      <InfoFooter />
    </>
  );
}
