import type { Metadata } from "next";
import Link from "next/link";
import { contact } from "@/content/pages/en";
import { infoLinkVisible } from "@/components/info/visibility";
import { PageHeading, T } from "@/components/info/text";

// LIVE on production (founder, 2026-10-15): the one info page that isn't
// hidden — no notFound() guard here, and indexable (overrides the group
// layout's noindex). Every other info page keeps its own guard.
export const metadata: Metadata = {
  title: contact.metaTitle,
  description: contact.metaDescription,
  robots: { index: true, follow: true },
};

export default function ContactPage() {
  return (
    <article>
      <PageHeading eyebrow={contact.eyebrow} title={contact.title} lede={contact.lede} />
      <div className="grid gap-5 sm:grid-cols-2">
        {contact.cards.map((c) => (
          <div key={c.title} className="rounded-2xl border border-brand-line p-6">
            <h2 className="font-display text-lg font-semibold">{c.title}</h2>
            <p className="mt-2 text-sm text-brand-muted">
              <T>{c.body}</T>
            </p>
            <p className="mt-4 text-sm font-semibold text-brand-teal-deep">
              <a href={`mailto:${c.email}`} className="hover:underline">
                {c.action}: {c.email}
              </a>
            </p>
          </div>
        ))}
      </div>
      <div className="mt-10 max-w-2xl space-y-2 text-sm text-brand-muted">
        <p>{contact.responseTime}</p>
        {/* Only where the Help page is actually live. */}
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
