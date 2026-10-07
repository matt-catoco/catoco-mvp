import type { Metadata } from "next";
import { terms, site } from "@/content/pages/en";
import { Banner, PageHeading, T } from "@/components/info/text";

export const metadata: Metadata = {
  title: terms.metaTitle,
  description: terms.metaDescription,
};

export default function Page() {
  return (
    <article>
      <Banner>{site.legalDraftBanner}</Banner>
      <PageHeading eyebrow={terms.eyebrow} title={terms.title} />
      <p className="-mt-6 mb-10 text-sm text-brand-muted">
        <T>{terms.effective}</T>
      </p>
      <div className="max-w-2xl space-y-8">
        {terms.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="font-display text-xl font-semibold">{s.heading}</h2>
            <div className="mt-2 space-y-3 text-brand-muted">
              {s.body.map((p, i) => (
                <p key={i}>
                  <T>{p}</T>
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
