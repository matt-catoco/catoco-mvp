import type { Metadata } from "next";
import { about } from "@/content/pages/en";
import { PageHeading } from "@/components/info/text";

// LIVE on production (founder, 2026-10-19), like Contact: no notFound() guard
// and indexable (overrides the group layout's noindex). One About us
// paragraph on top, company details small at the bottom.
export const metadata: Metadata = {
  title: about.metaTitle,
  description: about.metaDescription,
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <article>
      <PageHeading eyebrow={about.eyebrow} title={about.title} lede={about.lede} />
      <section aria-labelledby="company-details" className="mt-16 max-w-2xl">
        <h2 id="company-details" className="text-xs font-semibold text-brand-muted">
          {about.detailsHeading}
        </h2>
        <dl className="mt-3 space-y-1 text-xs text-brand-muted">
          {about.rows.map((r) => (
            <div key={r.label} className="flex flex-wrap gap-x-2">
              <dt className="font-medium">{r.label}:</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  );
}
