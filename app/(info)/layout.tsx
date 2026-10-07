import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoFooter, InfoHeader } from "@/components/info/info-shell";

// HIDDEN ON PRODUCTION: every page in this group (About, Contact, Help, Terms,
// Privacy, Company, Tutorials) returns a 404 and is no-indexed on the
// production deployment. Staging and preview deployments render normally.
// To launch: delete the notFound() guard below (and the robots line).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function InfoLayout({ children }: LayoutProps<"/">) {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <>
      <InfoHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-14">{children}</main>
      <InfoFooter />
    </>
  );
}
