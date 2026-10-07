import type { showcase } from "@/content/pages/en";

type Chapter = (typeof showcase.chapters)[number];

/** One tutorial clip. Native controls, no autoplay, poster until played. */
export function VideoCard({ chapter }: { chapter: Chapter }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-brand-line bg-background">
      <video
        controls
        preload="none"
        playsInline
        poster={chapter.poster}
        className="aspect-video w-full bg-black object-contain"
      >
        <source src={chapter.video} type="video/mp4" />
      </video>
      <figcaption className="p-5">
        <p className="text-sm font-medium text-brand-teal-deep">
          Chapter {chapter.number} · {chapter.length}
        </p>
        <h3 className="mt-1 font-display text-xl font-semibold">{chapter.title}</h3>
        <p className="mt-2 text-sm text-brand-muted">{chapter.blurb}</p>
      </figcaption>
    </figure>
  );
}
