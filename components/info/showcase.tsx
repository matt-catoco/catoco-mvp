import Link from "next/link";
import { showcase } from "@/content/pages/en";
import { VideoCard } from "./video-card";

/**
 * Homepage "see it live" section. NOT yet mounted: app/page.tsx is being
 * edited in another session, so to show it, add
 *   import { Showcase } from "@/components/info/showcase";
 * and render <Showcase /> where you want it (suggested: right after the hero).
 */
export function Showcase() {
  return (
    <section
      id="see-it-live"
      className="mx-auto w-full max-w-5xl px-6 py-20"
      aria-labelledby="showcase-title"
    >
      <p className="text-sm font-medium text-brand-teal-deep">{showcase.eyebrow}</p>
      <h2
        id="showcase-title"
        className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl"
      >
        {showcase.title}
      </h2>
      <p className="mt-3 max-w-2xl text-brand-muted">{showcase.intro}</p>
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {showcase.chapters.map((c) => (
          <VideoCard key={c.id} chapter={c} />
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          href="/tutorials"
          className="rounded-full bg-brand-teal px-5 py-2 text-sm font-semibold text-[#0d2020] hover:bg-brand-teal-deep hover:text-white"
        >
          {showcase.cta}
        </Link>
        <span className="text-xs text-brand-muted">{showcase.note}</span>
      </div>
    </section>
  );
}
