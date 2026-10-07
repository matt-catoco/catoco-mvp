import type { Metadata } from "next";
import { company, site } from "@/content/pages/en";
import { Banner, PageHeading, T } from "@/components/info/text";

export const metadata: Metadata = {
  title: company.metaTitle,
  description: company.metaDescription,
};

export default function CompanyPage() {
  return (
    <article>
      <Banner>{site.draftBanner}</Banner>
      <PageHeading eyebrow={company.eyebrow} title={company.title} lede={company.lede} />
      <dl className="max-w-2xl divide-y divide-brand-line border-y border-brand-line">
        {company.rows.map((r) => (
          <div key={r.label} className="grid gap-1 py-4 sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium">{r.label}</dt>
            <dd className="text-sm text-brand-muted sm:col-span-2">
              <T>{r.value}</T>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-sm text-brand-muted">{company.note}</p>
    </article>
  );
}
