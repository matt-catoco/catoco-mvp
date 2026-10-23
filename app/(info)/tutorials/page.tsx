import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { infoPagesHidden } from "@/components/info/visibility";
import Link from "next/link";
import { showcase, site, tutorials } from "@/content/pages/en";
import { Banner, PageHeading } from "@/components/info/text";
import { VideoCard } from "@/components/info/video-card";

export const metadata: Metadata = {
  title: tutorials.metaTitle,
  description: tutorials.metaDescription,
};

const TUTORIALS_HIDDEN = true;

export default function TutorialsPage() {
  // Hidden everywhere, staging included, until the videos are re-recorded (founder, 2026-10-23).
  // To bring it back: set TUTORIALS_HIDDEN to false and re-add the footer and site-map links.
  if (TUTORIALS_HIDDEN || infoPagesHidden()) notFound();
  return (
    <article>
      <Banner>{site.draftBanner}</Banner>
      <PageHeading eyebrow={tutorials.eyebrow} title={tutorials.title} lede={tutorials.lede} />
      <div className="space-y-14">
        {showcase.chapters.map((c) => (
          <section key={c.id} id={c.id} className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <VideoCard chapter={c} />
            <div>
              <h2 className="font-sans text-sm font-semibold text-brand-muted">
                {tutorials.transcriptLabel}
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-brand-muted">
                {(tutorials.narration[c.id] ?? []).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
      <p className="mt-12 text-xs text-brand-muted">{tutorials.footnote}</p>
      <p className="mt-4 text-sm text-brand-muted">
        <Link href={tutorials.cta.href} className="font-medium text-brand-teal-deep hover:underline">
          {tutorials.cta.label}
        </Link>
      </p>
    </article>
  );
}
