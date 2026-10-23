import type { Metadata } from "next";
import { suppliers } from "@/content/pages/en";
import { suppliersNl } from "@/content/pages/nl";
import { site } from "@/content/pages/en";
import { getLocale } from "@/lib/i18n/server";
import { infoLinkVisible } from "@/components/info/visibility";
import { Banner, PageHeading, T } from "@/components/info/text";
import { SupplierForm } from "./supplier-form";

// Supplier early list (founder, 2026-10-23). Reachable on staging AND
// production (it is for outreach) but deliberately unlinked: not in the
// header, footer or site map, and noindex. No login.
export const metadata: Metadata = {
  title: suppliers.metaTitle,
  robots: { index: false, follow: false },
};

export default async function ForSuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocale();
  // Dutch only once Matt's text is in (content/pages/nl.ts); English until then.
  const copy = locale === "nl" && suppliersNl ? suppliersNl : suppliers;
  const { src } = await searchParams;
  // The draft banner goes away once every [[placeholder]] is resolved.
  const draft = JSON.stringify(copy).includes("[[");

  return (
    <article>
      {draft && <Banner>{site.draftBanner}</Banner>}
      <PageHeading eyebrow={copy.eyebrow} title={copy.title} lede={copy.intro} />
      <ul className="max-w-2xl space-y-3">
        {copy.points.map((p, i) => (
          <li key={i} className="flex gap-3 text-brand-muted">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brand-teal-deep" />
            <span>
              <T>{p}</T>
            </span>
          </li>
        ))}
      </ul>

      <section aria-labelledby="early-list" className="mt-14 max-w-2xl rounded-2xl border border-brand-line p-6">
        <h2 id="early-list" className="font-display text-2xl font-semibold">
          {copy.formHeading}
        </h2>
        <p className="mt-1 text-brand-muted">{copy.formIntro}</p>
        <SupplierForm
          copy={copy}
          source={typeof src === "string" ? src : ""}
          privacyHref={infoLinkVisible("/privacy") ? "/privacy" : null}
        />
      </section>
    </article>
  );
}
