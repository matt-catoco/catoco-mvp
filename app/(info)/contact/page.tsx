import type { Metadata } from "next";
import Link from "next/link";
import { contact, site } from "@/content/pages/en";
import { Banner, PageHeading, T } from "@/components/info/text";

export const metadata: Metadata = {
  title: contact.metaTitle,
  description: contact.metaDescription,
};

export default function ContactPage() {
  const email = site.contactEmail;
  const isPlaceholder = email.includes("[[");
  return (
    <article>
      <Banner>{site.draftBanner}</Banner>
      <PageHeading eyebrow={contact.eyebrow} title={contact.title} lede={contact.lede} />
      <div className="grid gap-5 sm:grid-cols-3">
        {contact.cards.map((c) => (
          <div key={c.title} className="rounded-2xl border border-brand-line p-6">
            <h2 className="font-display text-lg font-semibold">{c.title}</h2>
            <p className="mt-2 text-sm text-brand-muted">
              <T>{c.body}</T>
            </p>
            <p className="mt-4 text-sm font-semibold text-brand-teal-deep">
              {isPlaceholder ? (
                <T>{email}</T>
              ) : (
                <a href={`mailto:${email}`} className="hover:underline">
                  {c.action}: {email}
                </a>
              )}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-10 max-w-2xl space-y-2 text-sm text-brand-muted">
        <p>
          <T>{contact.responseTime}</T>
        </p>
        <p>
          <T>{contact.languageNote}</T>
        </p>
        <p>
          {contact.helpLine}{" "}
          <Link href={contact.helpLink.href} className="font-medium text-brand-teal-deep hover:underline">
            {contact.helpLink.label}
          </Link>
          .
        </p>
      </div>
    </article>
  );
}
