import type { Metadata } from "next";
import Link from "next/link";
import { faq } from "@/content/pages/en";
import { PageHeading, T } from "@/components/info/text";

// LIVE on production (founder, 2026-10-23): no guard, indexable.
export const metadata: Metadata = {
  title: faq.metaTitle,
  description: faq.metaDescription,
  robots: { index: true, follow: true },
};

export default function FaqPage() {
  return (
    <article>
      <PageHeading eyebrow={faq.eyebrow} title={faq.title} lede={faq.lede} ledeLink={faq.ledeLink} />
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
        <a href={`mailto:${faq.supportEmail}`} className="font-medium text-brand-teal-deep hover:underline">
          {faq.supportEmail}
        </a>{" "}
        or{" "}
        <Link href={faq.stillStuckLink.href} className="font-medium text-brand-teal-deep hover:underline">
          {faq.stillStuckLink.label}
        </Link>
        .
      </p>
    </article>
  );
}
