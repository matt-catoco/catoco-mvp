import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { about, site } from "@/content/pages/en";
import { Banner, PageHeading, T } from "@/components/info/text";

// HIDDEN: not linked from nav/footer, not indexed, and returns 404 on the
// production deployment. It renders on staging and previews. To publish,
// delete the notFound() guard below, remove `robots` and add the link back to
// `site.nav` and `site.footer.links.company` in content/pages/en.ts.
export const metadata: Metadata = {
  title: about.metaTitle,
  description: about.metaDescription,
  robots: { index: false, follow: false },
};

export default function AboutPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <article>
      <Banner>{site.draftBanner}</Banner>
      <PageHeading eyebrow={about.eyebrow} title={about.title} lede={about.lede} />
      <div className="max-w-2xl space-y-10">
        {about.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="font-display text-2xl font-semibold">{s.heading}</h2>
            <div className="mt-3 space-y-3 text-brand-muted">
              {s.body.map((p, i) => (
                <p key={i}>
                  <T>{p}</T>
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-12 flex flex-wrap gap-4">
        <Link
          href={about.cta.href}
          className="rounded-full bg-brand-teal px-5 py-2 text-sm font-semibold text-[#0d2020] hover:bg-brand-teal-deep hover:text-white"
        >
          {about.cta.label}
        </Link>
        <Link
          href={about.ctaSecondary.href}
          className="rounded-full border border-brand-line px-5 py-2 text-sm font-semibold hover:border-brand-teal-deep"
        >
          {about.ctaSecondary.label}
        </Link>
      </div>
    </article>
  );
}
