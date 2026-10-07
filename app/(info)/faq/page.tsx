import type { Metadata } from "next";
import Link from "next/link";
import { faq, site } from "@/content/pages/en";
import { Banner, PageHeading, T } from "@/components/info/text";

export const metadata: Metadata = {
  title: faq.metaTitle,
  description: faq.metaDescription,
};

export default function FaqPage() {
  return (
    <article>
      <Banner>{site.draftBanner}</Banner>
      <PageHeading eyebrow={faq.eyebrow} title={faq.title} lede={faq.lede} />
      <div className="max-w-2xl space-y-12">
        {faq.groups.map((g) => (
          <section key={g.heading}>
            <h2 className="font-display text-2xl font-semibold">{g.heading}</h2>
            <div className="mt-4 divide-y divide-brand-line border-y border-brand-line">
              {g.items.map((item) => (
                <details key={item.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {item.q}
                    <span
                      aria-hidden
                      className="text-brand-teal-deep transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-brand-muted">
                    <T>{item.a}</T>
                  </p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-12 text-sm text-brand-muted">
        {faq.stillStuck}{" "}
        <Link href={faq.stillStuckLink.href} className="font-medium text-brand-teal-deep hover:underline">
          {faq.stillStuckLink.label}
        </Link>
        .
      </p>
    </article>
  );
}
