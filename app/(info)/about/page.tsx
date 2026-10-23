import type { Metadata } from "next";
import Image from "next/image";
import { about } from "@/content/pages/en";
import { PageHeading, T } from "@/components/info/text";

// LIVE on production (founder, 2026-10-19), like Contact: no notFound() guard
// and indexable (overrides the group layout's noindex). The story in short
// sections, then the team (2026-10-23). Company details are in the footer.
export const metadata: Metadata = {
  title: about.metaTitle,
  description: about.metaDescription,
  robots: { index: true, follow: true },
};

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[22px] w-[22px] fill-current">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

export default function AboutPage() {
  const { team } = about;
  return (
    <article>
      <PageHeading eyebrow={about.eyebrow} title={about.title} lede={about.lede} />
      <div className="max-w-2xl space-y-10">
        {about.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="font-display text-2xl font-semibold">{s.heading}</h2>
            <div className="mt-3 space-y-3 text-brand-muted">
              {s.body.map((p, i) => (
                <p key={i}>
                  <T>{p}</T>
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      {team.people.map((person) => (
        <section
          key={person.name}
          aria-label={person.name}
          className="mt-20 max-w-2xl border-t border-brand-line pt-12"
        >
          <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-[18px] sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-7">
            <Image
              src={person.photo.src}
              alt={person.photo.alt}
              width={person.photo.width}
              height={person.photo.height}
              sizes="(min-width: 640px) 112px, 88px"
              className="h-auto w-full"
            />
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-display text-3xl font-semibold">{person.name}</h2>
                <a
                  href={person.linkedin.href}
                  target="_blank"
                  rel="noopener"
                  aria-label={person.linkedin.label}
                  className="inline-flex leading-none text-brand-muted transition-colors hover:text-brand-teal"
                >
                  <LinkedInIcon />
                </a>
              </div>
              <p className="mt-1 text-[15px] font-medium text-brand-teal-deep">{person.role}</p>
              <div className="mt-5 max-w-xl space-y-3.5 text-brand-muted">
                {person.bio.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </div>
          </div>
        </section>
      ))}

      {team.advisers.length > 0 && (
        <section aria-labelledby="advisers" className="mt-12 max-w-2xl">
          <h2 id="advisers" className="font-display text-xl font-semibold">
            {team.advisersHeading}
          </h2>
          <ul className="mt-3 space-y-1.5 text-brand-muted">
            {team.advisers.map((a) => (
              <li key={a.name}>
                {a.href ? (
                  <a href={a.href} target="_blank" rel="noopener" className="font-medium text-foreground hover:text-brand-teal-deep">
                    {a.name}
                  </a>
                ) : (
                  <span className="font-medium text-foreground">{a.name}</span>
                )}
                , {a.role}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
