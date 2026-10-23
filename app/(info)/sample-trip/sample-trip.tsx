"use client";

import { useState } from "react";
import Link from "next/link";
import { ElementGrid } from "@/components/trip-home/element-grid";
import type { TileAlerts } from "@/components/trip-home/element-tile";
import { btnCommit, btnPrimary, btnSecondary } from "@/lib/ui";
import {
  ELEMENT_LABELS,
  ELEMENT_SYMBOLS,
  describeElementStatus,
  type ElementState,
  type ElementType,
  type FundingStatus,
} from "@/lib/trip-elements";

// Everything here is example data held in React state: no account, no
// database, nothing saved. A reload starts the tour over. The tiles are the
// real Trip Home ElementGrid fed through the real describeElementStatus(), so
// the wording matches the product.

const PAST = "2000-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";

const STEPS = [
  {
    key: "plan",
    title: "Plan",
    heading: "Break the trip into pieces",
    body: "Every trip is a set of elements: the dates, where to stay, how to get there, what to do. Lock in what is already decided and leave the rest open for the group.",
  },
  {
    key: "vote",
    title: "Vote",
    heading: "Everyone ranks the options",
    body: "Three experiences are on the table. Rank them from favourite to least favourite: your ranking counts alongside the rest of the group's, and the top choice locks when voting closes.",
  },
  {
    key: "fund",
    title: "Fund",
    heading: "Everyone pledges their share",
    body: "The stay is locked, so its cost is split across the five people it is for. Four have pledged already. Add a price cushion if you like, then pledge your share. Nobody pays until everyone is in.",
  },
  {
    key: "book",
    title: "Book",
    heading: "Pay, then book",
    body: "With everyone in, you get a payment request from the person collecting. Once everyone has paid, they book through the element's link and mark it booked, so the whole group sees it.",
  },
] as const;

const EXPERIENCES = [
  { id: "boat", name: "Sunset boat tour on the Guadalquivir", price: "€45 per person" },
  { id: "flamenco", name: "Flamenco night in Triana", price: "€38 per person" },
  { id: "cooking", name: "Tapas cooking class", price: "€60 per person" },
] as const;

// The other four travellers' rankings (first choice first).
const OTHER_RANKINGS: string[][] = [
  ["flamenco", "boat", "cooking"],
  ["boat", "flamenco", "cooking"],
  ["flamenco", "cooking", "boat"],
  ["cooking", "boat", "flamenco"],
];

const STAY_TOTAL = 1560;
const PEOPLE = 5;
const SHARE = STAY_TOTAL / PEOPLE;
const CUSHIONS = [
  { key: "none", label: "No extra", pct: 0 },
  { key: "p5", label: "+5%", pct: 5 },
  { key: "p10", label: "+10%", pct: 10, recommended: true },
] as const;

const euro = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

/** Borda count: first choice gets most points. Same idea as the real tally. */
function tally(rankings: string[][]) {
  const scores = new Map<string, number>(EXPERIENCES.map((e) => [e.id, 0]));
  for (const r of rankings) r.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + (EXPERIENCES.length - i)));
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

type Spec = {
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

export function SampleTrip() {
  const [step, setStep] = useState(0);
  const [ranking, setRanking] = useState<string[]>([]);
  const [votingClosed, setVotingClosed] = useState(false);
  const [cushion, setCushion] = useState<(typeof CUSHIONS)[number]["key"]>("p10");
  const [pledged, setPledged] = useState(false);
  const [paid, setPaid] = useState(false);
  const [booked, setBooked] = useState(false);

  const current = STEPS[step];
  const rankingDone = ranking.length === EXPERIENCES.length;
  const results = tally(rankingDone ? [...OTHER_RANKINGS, ranking] : OTHER_RANKINGS);
  const winner = EXPERIENCES.find((e) => e.id === results[0][0])!;
  const cushionPct = CUSHIONS.find((c) => c.key === cushion)!.pct;
  const pledgedCount = pledged ? 5 : 4;

  const specs: Spec[] = [
    { key: "dates", state: "locked", lockedVia: "organizer", fundingStatus: null, optionCount: 0, optionsDeadline: null, lockedValue: { start_date: "Sep 12", end_date: "Sep 19" }, bookedAt: null },
    { key: "destination", state: "locked", lockedVia: "vote", fundingStatus: null, optionCount: 0, optionsDeadline: null, lockedValue: { name: "Sevilla, ES" }, bookedAt: null },
    {
      key: "accommodation",
      state: "locked",
      lockedVia: "vote",
      fundingStatus: booked ? "booked" : pledged ? "ready_to_purchase" : "collecting",
      optionCount: 0,
      optionsDeadline: null,
      lockedValue: { name: "Casa Mare" },
      bookedAt: booked ? "2026-09-01T00:00:00Z" : null,
      alerts: { capacity: { count: pledgedCount }, myStatus: pledged ? { text: "Pledged", done: true } : { text: "Waiting on you", done: false } },
    },
    { key: "travel", state: "locked", lockedVia: "organizer", fundingStatus: "ready_to_purchase", optionCount: 0, optionsDeadline: null, lockedValue: { mode: "Flights" }, bookedAt: null },
    votingClosed
      ? { key: "experience", state: "locked", lockedVia: "vote", fundingStatus: null, optionCount: 0, optionsDeadline: null, lockedValue: { name: winner.name }, bookedAt: null }
      : {
          key: "experience",
          state: "open",
          lockedVia: null,
          fundingStatus: null,
          optionCount: 3,
          optionsDeadline: PAST,
          lockedValue: null,
          bookedAt: null,
          alerts: { deadlineText: "Voting closes in 2d", capacity: { count: 5 }, myStatus: rankingDone ? { text: "Voted", done: true } : { text: "Yet to vote", done: false } },
        },
    { key: "dining", state: "open", lockedVia: null, fundingStatus: null, optionCount: 2, optionsDeadline: FUTURE, lockedValue: null, bookedAt: null, alerts: { deadlineText: "Submissions close in 4d", capacity: { count: 5 } } },
  ];

  const tiles = specs.map((s, i) => {
    const info = describeElementStatus({ ...s, type: s.key });
    return {
      key: s.key,
      num: String(i + 1).padStart(2, "0"),
      tier: info.tier,
      statusLabel: info.statusLabel,
      detail: info.detail,
      symbol: ELEMENT_SYMBOLS[s.key],
      label: ELEMENT_LABELS[s.key],
      alerts: s.alerts,
    };
  });

  function rank(id: string) {
    if (votingClosed) return;
    setRanking((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  return (
    <article>
      <p className="mb-6 rounded-lg border border-brand-line bg-brand-teal-wash px-4 py-3 text-sm text-foreground">
        <b className="font-semibold">Sample trip.</b> Explore freely: nothing here is saved, and reloading the page
        starts it over. No account needed.
      </p>

      <header className="mb-8">
        <p className="text-sm font-medium text-brand-teal-deep">Trip</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Your Sample Trip</h1>
        <p className="mt-2 text-brand-muted">Sevilla · 12–19 September · 5 travellers</p>
      </header>

      {/* Tutorial callout */}
      <section aria-label="Tutorial" className="rounded-2xl border-[1.5px] border-brand-teal-deep p-5 sm:p-6">
        <ol className="flex flex-wrap gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  i === step
                    ? "border-brand-teal-deep bg-brand-teal-deep text-white"
                    : i < step
                      ? "border-brand-teal-deep text-brand-teal-deep"
                      : "border-brand-line text-brand-muted hover:border-brand-teal-deep"
                }`}
              >
                {i + 1}. {s.title}
              </button>
            </li>
          ))}
        </ol>
        <h2 className="mt-4 font-display text-2xl font-semibold">{current.heading}</h2>
        <p className="mt-2 max-w-2xl text-brand-muted">{current.body}</p>

        <div className="mt-5">
          {current.key === "plan" && (
            <ul className="grid gap-2 text-sm sm:grid-cols-3">
              <li className="rounded-xl border border-brand-line p-3">
                <b className="block font-semibold">Locked</b>
                <span className="text-brand-muted">Dates, Sevilla, Casa Mare and the flights are decided.</span>
              </li>
              <li className="rounded-xl border border-brand-line p-3">
                <b className="block font-semibold">Open for voting</b>
                <span className="text-brand-muted">Three experiences are waiting for everyone&apos;s ranking.</span>
              </li>
              <li className="rounded-xl border border-brand-line p-3">
                <b className="block font-semibold">Taking ideas</b>
                <span className="text-brand-muted">Anyone can still suggest where to eat.</span>
              </li>
            </ul>
          )}

          {current.key === "vote" && (
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">
                  {votingClosed ? "Voting is closed" : "Tap the options in your order of preference"}
                </p>
                <ul className="mt-2 space-y-2">
                  {EXPERIENCES.map((e) => {
                    const pos = ranking.indexOf(e.id);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => rank(e.id)}
                          disabled={votingClosed}
                          aria-pressed={pos >= 0}
                          className={`flex w-full items-center gap-3 rounded-xl border-[1.5px] px-3 py-2.5 text-left text-sm transition-colors ${
                            pos >= 0 ? "border-brand-teal-deep bg-brand-teal-wash" : "border-brand-line hover:border-brand-teal-deep"
                          }`}
                        >
                          <span
                            className={`grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold ${
                              pos >= 0 ? "bg-brand-teal-deep text-white" : "border border-dashed border-brand-line text-brand-muted"
                            }`}
                          >
                            {pos >= 0 ? pos + 1 : "–"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{e.name}</span>
                            <span className="text-xs text-brand-muted">{e.price}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {ranking.length > 0 && !votingClosed && (
                  <button type="button" onClick={() => setRanking([])} className="mt-2 text-xs text-brand-muted underline">
                    Clear my ranking
                  </button>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold">The group so far ({rankingDone ? 5 : 4} of 5 voted)</p>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {results.map(([id, score], i) => (
                    <li key={id} className="flex items-center justify-between gap-3 rounded-lg border border-brand-line px-3 py-2">
                      <span>
                        <b className="mr-1.5">{i + 1}.</b>
                        {EXPERIENCES.find((e) => e.id === id)!.name}
                      </span>
                      <span className="text-xs text-brand-muted">{score} pts</span>
                    </li>
                  ))}
                </ol>
                {votingClosed ? (
                  <p className="mt-3 text-sm font-semibold text-brand-teal-deep">✓ Locked: {winner.name}</p>
                ) : (
                  <button
                    type="button"
                    disabled={!rankingDone}
                    onClick={() => setVotingClosed(true)}
                    className={`mt-3 px-4 py-2 text-sm ${btnSecondary}`}
                  >
                    {rankingDone ? "Close voting (skip to the deadline)" : "Rank all three to cast your vote"}
                  </button>
                )}
              </div>
            </div>
          )}

          {current.key === "fund" && (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-xl border border-brand-line p-4">
                <p className="text-sm text-brand-muted">Accommodations · Casa Mare</p>
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-bold">{euro(SHARE)}</span>
                  <span className="text-sm text-brand-muted">your share of {euro(STAY_TOTAL)}</span>
                </p>
                {!pledged ? (
                  <>
                    <p className="mt-4 text-sm font-semibold">Protect against price changes</p>
                    <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Price cushion">
                      {CUSHIONS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          role="radio"
                          aria-checked={cushion === c.key}
                          onClick={() => setCushion(c.key)}
                          className={`flex min-w-[72px] flex-1 flex-col items-center rounded-xl border-[1.5px] px-2 py-1.5 text-sm font-semibold ${
                            cushion === c.key ? "border-brand-teal-deep bg-brand-teal-wash text-brand-teal-deep" : "border-brand-line"
                          }`}
                        >
                          {c.label}
                          {"recommended" in c && <span className="text-[10.5px] font-medium">recommended</span>}
                        </button>
                      ))}
                    </div>
                    <ul className="mt-3 ml-4 list-disc text-sm text-brand-muted">
                      <li className="text-foreground">
                        {cushionPct > 0
                          ? `You're pledging ${euro(SHARE)}, or up to ${euro(SHARE * (1 + cushionPct / 100))} if the price changes.`
                          : `You're pledging exactly ${euro(SHARE)}.`}
                      </li>
                      <li>You&apos;ll get a payment request once everyone has pledged.</li>
                    </ul>
                    <button type="button" onClick={() => setPledged(true)} className={`mt-4 w-full px-4 py-2.5 text-sm ${btnCommit}`}>
                      Pledge {euro(SHARE)}
                    </button>
                  </>
                ) : (
                  <p className="mt-4 text-sm font-semibold text-brand-teal-deep">✓ You&apos;ve pledged {euro(SHARE)}. Everyone is in.</p>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {pledgedCount} of {PEOPLE} pledged
                </p>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-brand-line" aria-hidden>
                  <div className="h-full bg-brand-teal-deep transition-all" style={{ width: `${(pledgedCount / PEOPLE) * 100}%` }} />
                </div>
                <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  {["Chelsea", "Ana", "Jon", "Rae", "You"].map((n) => {
                    const done = n !== "You" || pledged;
                    return (
                      <li
                        key={n}
                        className={`rounded-full border px-2.5 py-1 ${done ? "border-brand-line" : "border-dashed border-brand-line text-brand-muted"}`}
                      >
                        {done ? "✓ " : ""}
                        {n}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-sm text-brand-muted">
                  If someone drops out, the shares are recalculated. Anyone pushed above their price cushion is asked to
                  pledge again.
                </p>
              </div>
            </div>
          )}

          {current.key === "book" && (
            <div className="grid gap-5 md:grid-cols-2">
              {!pledged ? (
                <div className="rounded-xl border border-brand-line p-4 text-sm">
                  <p>Casa Mare still needs your pledge before anyone pays.</p>
                  <button type="button" onClick={() => setStep(2)} className={`mt-3 px-4 py-2 text-sm ${btnSecondary}`}>
                    Back to step 3
                  </button>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-brand-line p-4 text-sm">
                    <p className="font-semibold">Pay Chelsea {euro(SHARE)}</p>
                    <dl className="mt-2 space-y-1 text-brand-muted">
                      <div className="flex gap-2">
                        <dt>Bank transfer to</dt>
                        <dd className="text-foreground">C. Example</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt>Reference</dt>
                        <dd className="font-mono text-foreground">CTC-SAMPLE</dd>
                      </div>
                    </dl>
                    {paid ? (
                      <p className="mt-3 font-semibold text-brand-teal-deep">✓ Paid · confirmed by Chelsea</p>
                    ) : (
                      <button type="button" onClick={() => setPaid(true)} className={`mt-3 px-4 py-2 text-sm ${btnPrimary}`}>
                        I&apos;ve paid
                      </button>
                    )}
                  </div>
                  <div className="rounded-xl border border-brand-line p-4 text-sm">
                    <p className="font-semibold">Chelsea books the stay</p>
                    <p className="mt-1 text-brand-muted">
                      With everyone paid, the person collecting books on the provider&apos;s site and marks it booked.
                    </p>
                    {booked ? (
                      <p className="mt-3 font-semibold text-brand-teal-deep">✓ Casa Mare is booked and ready to go</p>
                    ) : (
                      <button
                        type="button"
                        disabled={!paid}
                        onClick={() => setBooked(true)}
                        className={`mt-3 px-4 py-2 text-sm ${btnPrimary}`}
                      >
                        {paid ? "Mark Casa Mare booked" : "Pay first, then book"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-brand-line pt-4">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className={`px-4 py-2 text-sm ${btnSecondary}`}
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => setStep((s) => s + 1)} className={`px-4 py-2 text-sm ${btnPrimary}`}>
              Next: {STEPS[step + 1].title}
            </button>
          ) : (
            <Link href="/#signup" className={`px-4 py-2 text-sm ${btnPrimary}`}>
              Join the beta
            </Link>
          )}
        </div>
      </section>

      <section aria-label="Trip overview" className="mt-10">
        <h2 className="mb-3 font-display text-xl font-semibold">Trip overview</h2>
        <ElementGrid tiles={tiles} cards />
      </section>
    </article>
  );
}
