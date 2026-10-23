import type { Metadata } from "next";
import Link from "next/link";
import { contact } from "@/content/pages/en";
import { infoLinkVisible } from "@/components/info/visibility";
import { PageHeading, T } from "@/components/info/text";

// LIVE on production (founder, 2026-10-15): no notFound() guard, indexable
// (overrides the group layout's noindex). One route since 2026-10-23: a
// single address for everything, plus the registered address.
export const metadata: Metadata = {
  title: contact.metaTitle,
  description: contact.metaDescription,
  robots: { index: true, follow: true },
};

export default function ContactPage() {
  return (
    <article>
      <PageHeading eyebrow={contact.eyebrow} title={contact.title} lede={contact.lede} />
      <div className="max-w-2xl rounded-2xl border border-brand-line p-6">
        <p className="font-display text-xl font-semibold text-brand-teal-deep">
          <a href={`mailto:${contact.email}`} className="hover:underline">
            {contact.email}
          </a>
        </p>
        <p className="mt-2 text-sm text-brand-muted">
          <T>{contact.emailNote}</T>
        </p>
        <a
          href={`mailto:${contact.email}`}
          className="mt-5 inline-block rounded-full bg-brand-teal px-5 py-2 text-sm font-semibold text-[#0d2020] hover:bg-brand-teal-deep hover:text-white"
        >
          {contact.emailLabel}
        </a>
      </div>
      <div className="mt-8 max-w-2xl">
        <h2 className="text-sm font-semibold">{contact.addressHeading}</h2>
        <p className="mt-1 text-sm text-brand-muted">{contact.address}</p>
      </div>
      <div className="mt-10 max-w-2xl space-y-2 text-sm text-brand-muted">
        <p>{contact.responseTime}</p>
        {infoLinkVisible(contact.helpLink.href) && (
          <p>
            {contact.helpLine}{" "}
            <Link href={contact.helpLink.href} className="font-medium text-brand-teal-deep hover:underline">
              {contact.helpLink.label}
            </Link>
            .
          </p>
        )}
      </div>
    </article>
  );
}
