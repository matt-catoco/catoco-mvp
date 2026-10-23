import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { infoPagesHidden, liveOnProduction } from "@/components/info/visibility";
import { PageHeading } from "@/components/info/text";

// STAGING ONLY (founder, 2026-10-22): every page that's built, so each can be
// opened and edited one by one even where the content isn't final. Hidden on
// production like the other draft pages. When you add a page, add it here.
export const metadata: Metadata = {
  title: "Site map",
  robots: { index: false, follow: false },
};

type Entry = { href: string; label: string; note?: string; linkable?: boolean };

const WEBSITE: Entry[] = [
  { href: "/", label: "Home" },
  { href: "/sample-trip", label: "Sample trip (no account needed)" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/faq", label: "Help and FAQ" },
  { href: "/terms", label: "Terms of service" },
  { href: "/privacy", label: "Privacy policy" },
];

const ACCOUNT: Entry[] = [
  { href: "/sign-in", label: "Sign in" },
  { href: "/sign-in/check-email", label: "Check your email", note: "shown after asking for a sign-in link" },
  { href: "/onboarding/profile", label: "Your name", note: "first visit after signing in" },
  { href: "/profile", label: "Profile" },
  { href: "/unsubscribe", label: "Unsubscribe", note: "opened from an email link; without the link it shows the \"link didn't work\" state" },
];

const TRIPS: Entry[] = [
  { href: "/trips", label: "My trips" },
  { href: "/trips/new", label: "New trip" },
  { href: "/trips/<trip>", label: "Trip home (table, calendar, kanban)", linkable: false },
  { href: "/trips/<trip>/elements/<element>", label: "Element page (ideas, vote, funding, booking)", linkable: false },
  { href: "/trips/<trip>/add-element", label: "Add element", linkable: false },
  { href: "/trips/<trip>/participants", label: "Participants", linkable: false },
  { href: "/trips/<trip>/payments", label: "Payments (organizers)", linkable: false },
  { href: "/trips/<trip>/settings", label: "Trip settings (organizers)", linkable: false },
  { href: "/trip/<trip>/join", label: "Join a trip (invite link)", linkable: false },
];

function Section({ title, entries, showLive }: { title: string; entries: Entry[]; showLive?: boolean }) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <ul className="mt-3 divide-y divide-brand-line border-y border-brand-line text-sm">
        {entries.map((e) => {
          // On catoco.co today: the same rule the site uses to hide draft pages.
          const live = liveOnProduction(e.href);
          return (
            <li key={e.href} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="min-w-0">
                {e.linkable === false ? (
                  <span className="font-medium">{e.label}</span>
                ) : (
                  <Link href={e.href} className="font-medium text-brand-teal-deep hover:underline">
                    {e.label}
                  </Link>
                )}
                <code className="ml-2 text-xs text-brand-muted">{e.href}</code>
                {e.note && <span className="block text-xs text-brand-muted">{e.note}</span>}
              </span>
              {showLive && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    live ? "bg-brand-teal-wash text-brand-accent" : "border border-brand-line text-brand-muted"
                  }`}
                >
                  {live ? "Live on catoco.co" : "Hidden on catoco.co"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function SiteMapPage() {
  if (infoPagesHidden()) notFound();
  return (
    <article>
      <PageHeading
        eyebrow="Staging"
        title="Site map"
        lede="Every page that's built, including drafts that are hidden on catoco.co. Open any of them to review and edit."
      />
      <div className="max-w-2xl space-y-10">
        <Section title="Website" entries={WEBSITE} showLive />
        <Section title="Account" entries={ACCOUNT} />
        <section>
          <Section title="Trips (signed in)" entries={TRIPS} />
          <p className="mt-3 text-xs text-brand-muted">
            Pages with &lt;trip&gt; need a real trip: open one from My trips. The &quot;Chelsea&apos;s 40th&quot; demo trips
            show each stage.
          </p>
        </section>
      </div>
    </article>
  );
}
