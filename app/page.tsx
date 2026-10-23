import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";
import { TallyEmbedScript } from "./tally-embed-script";
import { LogoMark } from "@/components/logo-mark";
import { legalLine } from "@/content/company";
import { infoLinkVisible } from "@/components/info/visibility";
import { site } from "@/content/pages/en";
import { ElementGrid } from "@/components/trip-home/element-grid";
import type { TileAlerts } from "@/components/trip-home/element-tile";
import { DOT_CLASSES } from "@/components/trip-home/status-legend";
import { btnCommit } from "@/lib/ui";
import {
  ELEMENT_LABELS,
  ELEMENT_SYMBOLS,
  describeElementStatus,
  type ElementState,
  type ElementTier,
  type ElementType,
  type FundingStatus,
} from "@/lib/trip-elements";
import { createClient } from "@/lib/supabase/server";

// Static demo data for the marketing showcase — the same shared ElementGrid/
// ElementTile the real Trip Home uses (components/trip-home/), fed synthetic
// per-element inputs run through the real describeElementStatus() instead of
// hand-typed label strings, so the homepage can't drift from the product's
// vocabulary. Home page alignment (founder mockup "Home Landing Revamp",
// 2026-10-15): all six elements, with the real alert icons and footers.
type DemoElementSpec = {
  key: ElementType;
  state: ElementState;
  lockedVia: "organizer" | "vote" | null;
  fundingStatus: FundingStatus;
  optionCount: number;
  optionsDeadline: string | null;
  lockedValue: Record<string, unknown> | null;
  bookedAt: string | null;
  alerts?: TileAlerts;
};

// Fixed far-past / far-future deadlines so "Open — Voting" vs "Submitting"
// never depends on when the page is rendered.
const PAST = "2000-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";

const DEMO: Record<string, DemoElementSpec> = {
  dates: {
    key: "dates",
    state: "locked",
    lockedVia: "organizer",
    fundingStatus: null,
    optionCount: 0,
    optionsDeadline: null,
    lockedValue: { start_date: "Sep 12", end_date: "Sep 19" },
    bookedAt: null,
  },
  destination: {
    key: "destination",
    state: "locked",
    lockedVia: "vote",
    fundingStatus: null,
    optionCount: 0,
    optionsDeadline: null,
    lockedValue: { name: "Sevilla, ES" },
    bookedAt: null,
  },
  accommodation: {
    key: "accommodation",
    state: "locked",
    lockedVia: "vote",
    fundingStatus: "collecting",
    optionCount: 0,
    optionsDeadline: null,
    lockedValue: { name: "Casa Mare" },
    bookedAt: null,
    alerts: {
      clock: "9h",
      clockAria: "Funding closes in 9h",
      notCommitted: true,
      capacity: { count: 4 },
      myStatus: { text: "Waiting on you", done: false },
    },
  },
  travel: {
    key: "travel",
    state: "locked",
    lockedVia: "organizer",
    fundingStatus: "ready_to_purchase",
    optionCount: 0,
    optionsDeadline: null,
    lockedValue: { mode: "Flights" },
    bookedAt: null,
  },
  experience: {
    key: "experience",
    state: "open",
    lockedVia: null,
    fundingStatus: null,
    optionCount: 3,
    optionsDeadline: PAST,
    lockedValue: null,
    bookedAt: null,
    alerts: {
      clock: "5h",
      clockAria: "Voting closes in 5h",
      capacity: { count: 3 },
      myStatus: { text: "Yet to vote", done: false },
    },
  },
  dining: {
    key: "dining",
    state: "open",
    lockedVia: null,
    fundingStatus: null,
    optionCount: 2,
    optionsDeadline: FUTURE,
    lockedValue: null,
    bookedAt: null,
    // No clock (2 days out is outside the alert window), so the footer
    // spells the deadline out.
    alerts: {
      deadlineText: "Submissions close in 2d",
      capacity: { count: 2 },
      myStatus: { text: "Submitted", done: true },
    },
  },
};

function demoTiles(keys: string[], statusLines?: 2 | 3) {
  return keys.map((k, i) => {
    const spec = DEMO[k];
    const info = describeElementStatus({ ...spec, type: spec.key });
    return {
      key: spec.key,
      num: String(i + 1).padStart(2, "0"),
      tier: info.tier,
      statusLabel: info.statusLabel,
      detail: info.detail,
      symbol: ELEMENT_SYMBOLS[spec.key],
      label: ELEMENT_LABELS[spec.key],
      alerts: spec.alerts,
      statusLines,
    };
  });
}

// Hero and elements band show the same six (founder, 2026-10-16: the 2x2
// hero read oddly).
const DEMO_TILES = demoTiles(["dates", "destination", "accommodation", "travel", "experience", "dining"]);
const HERO_TILES = demoTiles(["dates", "destination", "accommodation", "travel", "experience", "dining"], 3);

// Homepage legend: least to most done (the shared StatusLegend reads the
// other way round for Table/Kanban).
const HOME_LEGEND: { tier: ElementTier; label: string }[] = [
  { tier: "open", label: "Open" },
  { tier: "locked", label: "Locked" },
  { tier: "funded", label: "Funded" },
  { tier: "ready", label: "Ready to go" },
];

const hatched = {
  background: "repeating-linear-gradient(135deg, var(--brand-teal-wash) 0 6px, var(--brand-line) 6px 12px)",
  boxShadow: "inset 0 0 0 1.5px var(--brand-teal-deep)",
};

function HatchedBar({ pct }: { pct: number }) {
  return (
    <div className="h-3 overflow-hidden rounded-full" style={hatched} aria-hidden>
      <div className="h-full bg-brand-teal-deep" style={{ width: `${pct}%` }} />
    </div>
  );
}

const COMMIT_PEOPLE = [
  { initials: "AL", name: "Ana", committed: true },
  { initials: "JK", name: "Jon", committed: true },
  { initials: "RP", name: "Rae", committed: true },
  { initials: "MS", name: "You", committed: false },
  { initials: "TB", name: "Tom", committed: false },
];

// Bricolage Grotesque + Inter are now loaded once, platform-wide, in
// app/layout.tsx — page.module.css's --font-display/--font-body already
// just reference those same CSS variables by name, so nothing else here
// needs to change.

export const metadata: Metadata = {
  title: `Catoco — ${site.tagline}`,
  description:
    "Catoco turns your group chat's next trip idea into a real, funded, booked trip — everyone votes on the details, everyone chips in, and no one gets stuck holding the bill.",
};

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8.5L6.5 12L13 4"
        stroke="#0F8C7E"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function Home() {
  // The homepage got its own auth-aware header (2026-09-02) instead of
  // stacking the global SiteNav on top of it — same createClient() +
  // auth.getUser() pattern SiteNav itself uses, so the sign-in state stays
  // consistent everywhere without a second source of truth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <nav className={`${styles.nav} ${styles.wrap}`}>
          <Link href="/" className={styles.brand}>
            <LogoMark />
            catoco
          </Link>
          <div className={styles.navLinks}>
            <a href="#how">How it works</a>
            <Link href="/sample-trip">Sample trip</Link>
            <Link href="/about">About</Link>
            <Link href="/faq">Help</Link>
            <Link href="/contact">Contact</Link>
          </div>
          <div className={styles.navCtaWrap}>
            {user ? (
              <Link href="/trips" className={styles.linkQuiet}>
                My Trips
              </Link>
            ) : (
              <Link href="/sign-in" className={styles.linkQuiet}>
                Sign in
              </Link>
            )}
            <a
              href="#signup"
              data-tally-open="J94zBo"
              className={`${styles.btn} ${styles.btnPrimary}`}
            >
              Join the beta
            </a>
          </div>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div>
            <h1 className={styles.heroH1}>
              {site.tagline}
            </h1>
            <p className={styles.heroSub}>
              From &ldquo;we should go&rdquo; to &ldquo;we went.&rdquo;
            </p>
            <div className={styles.heroActions}>
              {/* Opens a pre-filled trip with no account needed (app/(info)/sample-trip). */}
              <Link href="/sample-trip" className={`${styles.btn} ${styles.btnPrimary}`}>
                Try a sample trip
              </Link>
              <a
                href="#signup"
                data-tally-open="J94zBo"
                className={`${styles.btn} ${styles.btnGhost}`}
              >
                Join the beta
              </a>
            </div>
          </div>
          <div className={styles.tileStage}>
            <div className={styles.tileStageLabel}>
              Chelsea&apos;s 40th · trip overview
            </div>
            <div className={styles.heroTiles}>
              <ElementGrid tiles={HERO_TILES} cards />
            </div>
            <div className={styles.legend}>
              {HOME_LEGEND.map(({ tier, label }) => (
                <span key={tier} className={styles.legendItem}>
                  <span className={`h-2 w-2 flex-none rounded-full border-2 ${DOT_CLASSES[tier]}`} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.problem}`}>
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>
              Messaging apps coordinate chaos, with no clear moment of
              agreement.
            </h2>
          </div>
          <div className={styles.problemGrid}>
            <div className={styles.problemCard}>
              <div className={styles.mark}>01</div>
              <h3>Everyone has an opinion, nobody has the final say</h3>
              <p>
                Destination, dates, budget. Nine people, nine sets of
                preferences, and no clean way to land on one answer.
              </p>
            </div>
            <div className={styles.problemCard}>
              <div className={styles.mark}>02</div>
              <h3>Somebody always ends up fronting the money</h3>
              <p>
                One person books, then spends the next month chasing seven
                Venmo requests and hoping nobody bails.
              </p>
            </div>
            <div className={styles.problemCard}>
              <div className={styles.mark}>03</div>
              <h3>The plan lives in five different apps</h3>
              <p>
                A group chat, a spreadsheet, three payment links, and a shared
                doc nobody&apos;s opened since March.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="how">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>From intent to itinerary</h2>
            <p className={styles.tagline}>No chasing. No heroes. No awkwardness.</p>
          </div>
          <div className={styles.steps}>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Create</h3>
              <p>Name the trip, rough dates, who&apos;s coming.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Add options</h3>
              <p>Search flights, stays and experiences, or add your own idea.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Vote</h3>
              <p>Everyone ranks their favourites and compares the options.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Lock</h3>
              <p>The top choice locks when voting closes, or the organizer locks it sooner.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Commit</h3>
              <p>Everyone commits their share. Nobody is charged until everyone is in.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Go</h3>
              <p>Funded means booked. Easy peasy.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.fronts}>
        <div className={`${styles.wrap} ${styles.frontsGrid}`}>
          <div>
            <h2 className={styles.frontsH2}>Nobody fronts the money</h2>
            <ol className={styles.frontsList}>
              <li>
                <span className={styles.frontsNum}>1</span>
                <div>
                  <b>Commit your share</b>
                  <span>You authorize it. Nothing is charged yet.</span>
                </div>
              </li>
              <li>
                <span className={styles.frontsNum}>2</span>
                <div>
                  <b>Charged when everyone is in</b>
                  <span>The money only moves once the whole group has committed.</span>
                </div>
              </li>
              <li>
                <span className={styles.frontsNum}>3</span>
                <div>
                  <b>Released if the goal isn&apos;t met</b>
                  <span>If it isn&apos;t funded by the deadline, nobody pays anything.</span>
                </div>
              </li>
            </ol>
            <p className={styles.frontsNote}>Changed your mind? You can withdraw until the deadline.</p>
          </div>

          {/* A static example of the real Commit card (funding-card.tsx). */}
          <div
            aria-label="Example of the Commit card"
            role="figure"
            className="mx-auto flex w-full max-w-[460px] flex-col gap-3.5 rounded-[20px] border-[1.5px] border-brand-teal-deep bg-[var(--paper)] p-[22px] text-[var(--ink)]"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-[11px] border border-brand-line bg-[var(--white)] font-[family-name:var(--font-display)] text-[15px] font-bold text-brand-teal-deep">
                Ac
              </span>
              <div>
                <p className="font-[family-name:var(--font-display)] text-xl font-bold leading-tight">Accommodations</p>
                <p className="text-[13px] text-[var(--muted)]">Casa Mare, Cagliari</p>
              </div>
            </div>
            <span className="w-fit rounded-full border-[1.5px] border-brand-teal-deep px-2.5 py-0.5 text-xs font-semibold text-brand-teal-deep">
              Ready to fund
            </span>
            <p className="flex items-baseline gap-1.5">
              <span className="font-[family-name:var(--font-display)] text-[34px] font-bold leading-none tracking-[-0.02em]">€312</span>
              <span className="text-sm text-[var(--muted)]">your share</span>
            </p>
            <span className={`${btnCommit} pointer-events-none`} aria-hidden>
              Commit €312
            </span>
            <p className="-mt-1 text-center text-[12.5px] text-[var(--muted)]">Nothing charged until everyone is committed.</p>
            <HatchedBar pct={60} />
            <div className="flex justify-between text-[13px] text-[var(--muted)]">
              <span>
                <b className="text-[var(--ink)]">3 of 5</b> committed
              </span>
              <span>€936 of €1,560</span>
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Who's committed">
              {COMMIT_PEOPLE.map((p) => (
                <li
                  key={p.initials}
                  className={`flex items-center gap-1.5 rounded-full border bg-[var(--white)] py-0.5 pl-[3px] pr-2.5 text-[12.5px] ${
                    p.committed ? "border-brand-line" : "border-dashed border-brand-line text-[var(--muted)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid size-[22px] place-items-center rounded-full font-[family-name:var(--font-display)] text-[9.5px] font-bold ${
                      p.committed ? "bg-brand-teal-wash text-brand-accent" : "bg-[var(--line)] text-[var(--muted)]"
                    }`}
                  >
                    {p.initials}
                  </span>
                  {p.name}
                  <span className="sr-only">{p.committed ? " — committed" : " — not yet"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.elements}`} id="elements">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>Every trip, broken into the choices that matter</h2>
            <p>
              Every trip is built on a foundation of elements. Lock what you
              already know, leave the rest open for the group to decide.
            </p>
          </div>
          <div className={styles.bandTiles}>
            <ElementGrid tiles={DEMO_TILES} onDark cards />
          </div>
        </div>
      </section>

      <section className={styles.inside}>
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>One place for the whole plan</h2>
          </div>
          <div className={styles.insideGrid}>
            <div className={styles.insideCard}>
              <div className={styles.snip} aria-hidden>
                <div className={`${styles.voteRow} ${styles.voteRowSel}`}>
                  <span>Casa Mare</span>
                  <em>2 votes · your pick</em>
                </div>
                <div className={styles.voteRow}>
                  <span>Villa Cala Luna</span>
                  <em>1 vote</em>
                </div>
              </div>
              <h3>Vote and compare</h3>
              <p>Rank your favourites and put the options side by side.</p>
            </div>
            <div className={styles.insideCard}>
              <div className={styles.snip} aria-hidden>
                <HatchedBar pct={80} />
                <div className="flex justify-between text-[13px] text-[var(--muted)]">
                  <span>
                    <b className="text-[var(--ink)]">4 of 5</b> committed
                  </span>
                  <span>€1,248 of €1,560</span>
                </div>
              </div>
              <h3>Track who has committed</h3>
              <p>See where each element stands, and who is still to commit.</p>
            </div>
            <div className={styles.insideCard}>
              <div className={styles.snip} aria-hidden>
                <div className={styles.seg}>
                  <span>Table</span>
                  <span className={styles.segOn}>Calendar</span>
                </div>
                <div className={styles.days}>
                  <div>
                    Sat<b>12</b>
                    <span>Ac · Casa Mare</span>
                  </div>
                  <div>
                    Sun<b>13</b>
                    <span>Ex · Boat tour</span>
                  </div>
                  <div>
                    Mon<b>14</b>
                    <span>Dn · Dinner</span>
                  </div>
                </div>
              </div>
              <h3>See it your way</h3>
              <p>A table of every element, or a calendar and itinerary of the trip.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.pullquote}>
        <div className={styles.wrap}>
          <p className={styles.pqText}>
            &ldquo;Coordination is where you start.
            <br />
            Commitment is where you end.&rdquo;
          </p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.signup}`} id="signup">
        <div className={styles.wrap}>
          <div className={styles.signupCard}>
            <div>
              <h2>Be one of the first groups to try it</h2>
              <p className={styles.heroSub}>
                We&apos;re building this with real groups before a full
                launch. Tell us about your next trip idea and we&apos;ll
                reach out when your beta spot is ready.
              </p>
              <ul className={styles.signupList}>
                <li>
                  <CheckIcon />
                  Free to join, no card required
                </li>
                <li>
                  <CheckIcon />
                  Early groups shape what we build next
                </li>
                <li>
                  <CheckIcon />A few minutes, that&apos;s the whole ask
                </li>
              </ul>
            </div>
            <div className={styles.tallyFrame}>
              <span className={styles.tfLabel}>Beta signup</span>
              <div className={styles.miniForm}>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="Your name"
                  className={styles.miniInput}
                />
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="Email"
                  className={styles.miniInput}
                />
                <button
                  type="button"
                  data-tally-open="J94zBo"
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.miniSubmit}`}
                >
                  Continue
                </button>
              </div>
              <div className={styles.tfNote}>
                Opens the real Catoco Beta Signup form.
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <div className={styles.footRow}>
            <Link href="/" className={styles.footBrand}>
              <LogoMark />
              catoco
            </Link>
            <div className={styles.footLinks}>
              <Link href="/sample-trip">Sample trip</Link>
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/faq">Help</Link>
              <a href={site.linkedin.href} target="_blank" rel="noopener">
                {site.linkedin.label}
              </a>
              {/* Draft pages: linked on staging so every page can be reviewed; hidden on catoco.co. */}
              {[
                { href: "/tutorials", label: "Tutorials" },
                { href: "/terms", label: "Terms" },
                { href: "/privacy", label: "Privacy" },
                { href: "/site-map", label: "Site map" },
              ]
                .filter((l) => infoLinkVisible(l.href))
                .map((l) => (
                  <Link key={l.href} href={l.href}>
                    {l.label}
                  </Link>
                ))}
              <a href="mailto:hello@catoco.co">hello@catoco.co</a>
            </div>
          </div>
          <p className={styles.footCopy}>{site.tagline}</p>
          <p className={styles.footCopy} style={{ marginTop: 6 }}>© 2026 Catoco.</p>
          <p className={styles.footCopy} style={{ marginTop: 6 }}>{legalLine.en}</p>
        </div>
      </footer>

      <TallyEmbedScript />
    </div>
  );
}
