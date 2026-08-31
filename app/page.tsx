import type { Metadata } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import styles from "./page.module.css";
import { TallyEmbedScript } from "./tally-embed-script";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cataco — Plan it together. Fund it together. Go.",
  description:
    "Cataco turns your group chat's next trip idea into a real, funded, booked trip — everyone votes on the details, everyone chips in, and no one gets stuck holding the bill.",
};

// Exact markup from design-handoff/cataco-mark.svg (the finalized "Element
// Tile" mark) — public/brand/cataco-mark.svg is the same file, kept there for
// any future non-inline use (dark/mono variants live alongside it).
function LogoMark() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden>
      <rect width="512" height="512" rx="113" fill="#2DD4BF" />
      <rect
        x="77"
        y="77"
        width="358"
        height="358"
        rx="61"
        fill="none"
        stroke="#0D2020"
        strokeWidth="15"
        strokeDasharray="15,20"
      />
      <rect
        x="184"
        y="184"
        width="144"
        height="144"
        rx="31"
        fill="#0D2020"
        transform="rotate(45 256 256)"
      />
    </svg>
  );
}

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

export default function Home() {
  return (
    <div className={`${styles.page} ${bricolage.variable} ${inter.variable}`}>
      <header className={styles.header}>
        <nav className={`${styles.nav} ${styles.wrap}`}>
          <Link href="/" className={styles.brand}>
            <LogoMark />
            cataco
          </Link>
          <div className={styles.navLinks}>
            <a href="#how">How it works</a>
            <a href="#elements">The elements</a>
          </div>
          <div className={styles.navCtaWrap}>
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
            <span className={styles.eyebrow}>
              <span className={styles.dot} />
              Beta opening soon
            </span>
            <h1 className={styles.heroH1}>
              From &ldquo;we should go&rdquo; to &ldquo;we went.&rdquo;
            </h1>
            <p className={styles.heroSub}>
              Cataco turns your group chat&apos;s next trip idea into a real,
              funded, booked trip — everyone votes on the details, everyone
              chips in, and no one gets stuck holding the bill.
            </p>
            <div className={styles.heroActions}>
              <a
                href="#signup"
                data-tally-open="J94zBo"
                className={`${styles.btn} ${styles.btnPrimary}`}
              >
                Join the beta
              </a>
              <a href="#how" className={styles.linkQuiet}>
                See how it works
              </a>
            </div>
          </div>
          <div className={styles.tileStage}>
            <div className={styles.tileStageLabel}>
              Accommodations — still deciding
            </div>
            <div className={styles.tileGrid}>
              <div className={`${styles.tile} ${styles.open}`}>
                <span className={styles.sym}>Hs</span>
                <span className={styles.lbl}>Hostel</span>
                <span className={styles.num}>04</span>
              </div>
              <div className={`${styles.tile} ${styles.candidate}`}>
                <span className={styles.sym}>Vl</span>
                <span className={styles.lbl}>Villa</span>
                <span className={styles.num}>14</span>
              </div>
              <div className={`${styles.tile} ${styles.open}`}>
                <span className={styles.sym}>Ap</span>
                <span className={styles.lbl}>Apartment</span>
                <span className={styles.num}>21</span>
              </div>
              <div className={`${styles.tile} ${styles.open}`}>
                <span className={styles.sym}>Cb</span>
                <span className={styles.lbl}>Cabin</span>
                <span className={styles.num}>08</span>
              </div>
              <div className={`${styles.tile} ${styles.locked}`}>
                <span className={styles.sym}>Lf</span>
                <span className={styles.lbl}>Loft</span>
                <span className={styles.num}>09</span>
              </div>
              <div className={`${styles.tile} ${styles.open}`}>
                <span className={styles.sym}>Tn</span>
                <span className={styles.lbl}>Tent</span>
                <span className={styles.num}>02</span>
              </div>
            </div>
            <div className={styles.convergenceNote}>
              <span className={`${styles.swatch} ${styles.d}`} /> open, still
              voting &nbsp;·&nbsp;
              <span className={`${styles.swatch} ${styles.s}`} /> locked in by
              the group
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.problem}`}>
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>They die in chats and spreadsheets.</h2>
            <p>
              It&apos;s not that nobody wants to go. It&apos;s that &ldquo;we
              should do this&rdquo; has nowhere to turn into &ldquo;it&apos;s
              booked.&rdquo;
            </p>
          </div>
          <div className={styles.problemGrid}>
            <div className={styles.problemCard}>
              <div className={styles.mark}>01</div>
              <h3>Everyone has an opinion, nobody has the final say</h3>
              <p>
                Destination, dates, budget — nine people, nine sets of
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
            <p className={styles.tagline}>
              No chasing. No heroes. No awkwardness.
            </p>
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
              <p>Everyone throws in ideas for stays, activities, food.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Vote</h3>
              <p>The group ranks what they actually want.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Converge</h3>
              <p>Top choices lock in automatically.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Fund</h3>
              <p>Everyone chips in, tracked in one place.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepRail} />
              <h3>Go</h3>
              <p>Funded means booked. That&apos;s it.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.elements}`} id="elements">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>Every trip, broken into the choices that matter</h2>
            <p>
              Every trip is built on a foundation of elements — lock what you
              already know, leave the rest open for the group to decide.
            </p>
          </div>
          <div className={styles.elGrid}>
            <div className={`${styles.elTile} ${styles.locked}`}>
              <div className={styles.num}>01</div>
              <div className={styles.sym}>Dt</div>
              <div className={styles.name}>Dates</div>
              <div className={styles.state}>Locked by organizer</div>
            </div>
            <div className={`${styles.elTile} ${styles.locked}`}>
              <div className={styles.num}>02</div>
              <div className={styles.sym}>Ds</div>
              <div className={styles.name}>Destination</div>
              <div className={styles.state}>Locked by organizer</div>
            </div>
            <div className={`${styles.elTile} ${styles.open}`}>
              <div className={styles.num}>03</div>
              <div className={styles.sym}>Bg</div>
              <div className={styles.name}>Budget</div>
              <div className={styles.state}>Open — voting</div>
            </div>
            <div className={`${styles.elTile} ${styles.open}`}>
              <div className={styles.num}>04</div>
              <div className={styles.sym}>Pt</div>
              <div className={styles.name}>Participants</div>
              <div className={styles.state}>Open — invites out</div>
            </div>
            <div className={`${styles.elTile} ${styles.open}`}>
              <div className={styles.num}>05</div>
              <div className={styles.sym}>Tr</div>
              <div className={styles.name}>Travel</div>
              <div className={styles.state}>Open — voting</div>
            </div>
            <div className={`${styles.elTile} ${styles.open}`}>
              <div className={styles.num}>06</div>
              <div className={styles.sym}>Ac</div>
              <div className={styles.name}>Accommodations</div>
              <div className={styles.state}>Open — voting</div>
            </div>
            <div className={`${styles.elTile} ${styles.open}`}>
              <div className={styles.num}>07</div>
              <div className={styles.sym}>Ex</div>
              <div className={styles.name}>Experiences</div>
              <div className={styles.state}>Open — voting</div>
            </div>
            <div className={`${styles.elTile} ${styles.open}`}>
              <div className={styles.num}>08</div>
              <div className={styles.sym}>Dn</div>
              <div className={styles.name}>Dining</div>
              <div className={styles.state}>Open — voting</div>
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
                Opens the real Cataco Alpha Signup form.
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
              cataco
            </Link>
            <div className={styles.footLinks}>
              <a href="#how">How it works</a>
              <a href="#elements">The elements</a>
              <a href="mailto:hello@catoco.co">hello@catoco.co</a>
            </div>
          </div>
          <p className={styles.footCopy}>© 2026 Cataco.</p>
        </div>
      </footer>

      <TallyEmbedScript />
    </div>
  );
}
