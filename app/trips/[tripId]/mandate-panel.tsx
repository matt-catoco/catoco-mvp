"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { cancelFundingMandate, setMandateCushion, startFundingMandate, syncFundingMandate } from "./payment-actions";
import { btnCommit, btnPrimary, btnSecondary, fieldClass } from "@/lib/ui";
import { platformFee } from "@/lib/platform-fee";
import { formatCurrency } from "@/lib/trip-elements";
import { ShareBreakdown } from "@/components/share-breakdown";
import { cushionCap, cushionOptions, type CushionChoice } from "@/lib/cushion";
import { HoldPhasePanel, type RetryStatus } from "./retry-panel";
import { TestModeBadge } from "./test-mode-badge";
import { Lightbox, TravelerDetailsFields, useTravelerGate } from "./traveler-details";

// Loaded once per page, lazily, only when this panel actually renders.
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  // Test-mode only, mirroring the server's sk_test_ guard.
  if (!key || !key.startsWith("pk_test_")) return null;
  stripePromise ??= loadStripe(key);
  return stripePromise;
}

export type MyMandateInfo = {
  id: string;
  status:
    | "pending"
    | "active"
    | "charging"
    | "held"
    | "awaiting_retry"
    | "charge_succeeded"
    | "charge_failed"
    | "canceled"
    | "refunded";
  /** awaiting_retry: what the participant must do. */
  retryReason?: string | null;
  paymentMethodType: "card" | "sepa_debit" | null;
  failureReason: string | null;
  /** Authorized "up to" (share + the participant's own cushion). */
  maxAmount?: number | null;
};

export type MandatePanelProps = {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  currency: string;
  individualAmount: number;
  /** Catoco fee % added on top of the share (0 for pre-fee requests). */
  platformFeePercent: number;
  deadline: string | null;
  chargeStatus: "charging" | "capturing" | "charged" | "failed" | null;
  chargeFailureReason: string | null;
  myMandate: MyMandateInfo | null;
  population: number;
  covered: number;
  /** Already covered by a pre-Stripe manual contribution. */
  alreadyContributed: boolean;
  /** Every spot is already committed by others (limited-spots element). */
  waitlisted?: boolean;
  /** Share + price cushion — what a new authorization covers "up to". */
  capAmount?: number | null;
  /** Holds phase: the group's live retry-buffer status. */
  retry?: RetryStatus | null;
  isOrganizerView?: boolean;
  /** Commit modal subtitle: "Accommodations · Casa Mare" */
  elementLabel?: string;
  optionTitle?: string;
  /** The group's funding goal, for the modal's notice copy. */
  requiredAmount?: number;
  /** §5: the trip allows a cushion and the price can be re-checked (vendor option). */
  cushionAllowed?: boolean;
  /** §6: someone else withdrew and the organizer hasn't recalculated — commits pause. */
  sharesMayChange?: boolean;
  /** §6: shares were re-split after a withdrawal (for "still covered"). */
  sharesRecalculatedAt?: string | null;
  /** §5: the trip's (or element's) cushion — pre-selected and marked "recommended". */
  recommendedCushion?: CushionChoice | null;
  /** §6: the cost is split across the group (flat / per night), so a withdrawal changes others' shares. */
  groupSplit?: boolean;
  /** §6: while a withdrawal is pending, the share if it's recalculated for `remaining` people. */
  withdrawalEstimate?: { remaining: number; newShare: number } | null;
};

const METHOD_LABEL = { card: "card", sepa_debit: "SEPA Direct Debit" } as const;
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-deep focus-visible:ring-offset-2";
const textLink = `rounded-sm text-[13px] font-semibold text-brand-muted underline underline-offset-[3px] hover:text-foreground disabled:opacity-50 ${focusRing}`;

function failureCopy(reason: string | null): string {
  if (reason === "not_fully_mandated") {
    return "Not everyone committed by the deadline, so nobody was charged.";
  }
  if (reason === "retry_expired") {
    return "One payment couldn't be fixed in time, so everyone's commitment was released — nobody was charged.";
  }
  return "A payment failed at the final step after others had gone through, so the pool was called off — those charges are being refunded automatically.";
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * The participant's side of mandate-based funding (flow #4; "After Commit"
 * pass, 2026-10-14). Commit opens a one- or two-step lightbox (traveler
 * details when owed, then the Stripe authorization with an optional price
 * cushion); nothing is charged until everyone is committed. Withdraw is
 * allowed until the deadline. Stripe TEST MODE only.
 */
export function MandatePanel(props: MandatePanelProps) {
  const { currency, individualAmount, deadline, chargeStatus, myMandate, population, covered } = props;
  const fee = platformFee(individualAmount, props.platformFeePercent);
  const router = useRouter();
  const [setup, setSetup] = useState<{
    mandateId: string;
    clientSecret: string;
    methods: string[];
    sepaUnavailable: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const travelerGate = useTravelerGate();
  const stripeJs = useMemo(() => getStripeJs(), []);
  const [checkout, setCheckout] = useState<{ step: "details" | "starting" | "pay" | "paying"; twoSteps: boolean } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawPending, startWithdraw] = useTransition();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // §5 cushion choice — client state until "Authorize".
  const options = cushionOptions(props.recommendedCushion ?? null, (n) => formatCurrency(n, currency));
  const [cushionKey, setCushionKey] = useState<string>((options.find((o) => o.recommended) ?? options[0]).key);
  const [customAmount, setCustomAmount] = useState("");
  const cushion: CushionChoice = !props.cushionAllowed
    ? { kind: "none" }
    : cushionKey === "custom"
      ? { kind: "amount", value: Math.min(Math.max(0, Number(customAmount) || 0), individualAmount) }
      : (options.find((o) => o.key === cushionKey)?.choice ?? { kind: "none" });

  function begin(twoSteps: boolean) {
    setError(null);
    setCheckout({ step: "starting", twoSteps });
    startTransition(async () => {
      const res = await startFundingMandate(props.tripId, props.elementId, props.fundingRequestId, cushion);
      if (res.error || !res.clientSecret || !res.mandateId) {
        setError(res.error ?? "Couldn't start the authorization. Try again.");
        return;
      }
      setSetup({
        mandateId: res.mandateId,
        clientSecret: res.clientSecret,
        methods: res.paymentMethodTypes ?? ["card"],
        sepaUnavailable: Boolean(res.sepaUnavailable),
      });
      setCheckout({ step: "pay", twoSteps });
    });
  }

  function closeCheckout() {
    const started = checkout?.step === "pay";
    setCheckout(null);
    setSetup(null);
    setError(null);
    if (started) router.refresh();
  }

  const active = myMandate?.status === "active";
  const inFlight = myMandate?.status === "charging" || myMandate?.status === "charge_succeeded";

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-black dark:text-zinc-50">Fund it</span>
      <TestModeBadge />
    </div>
  );

  const progress = (
    <p className="mt-2 text-xs text-brand-muted">
      {covered} of {population} committed
      {deadline ? " · charged at the funding deadline, only if everyone is committed" : ""}
    </p>
  );

  if (chargeStatus === "charging") {
    return (
      <HoldPhasePanel
        tripId={props.tripId}
        elementId={props.elementId}
        fundingRequestId={props.fundingRequestId}
        currency={currency}
        share={individualAmount + fee}
        myStatus={myMandate?.status ?? null}
        myRetryReason={myMandate?.retryReason ?? null}
        myMandateId={myMandate?.id ?? null}
        retry={props.retry ?? null}
        isOrganizerView={Boolean(props.isOrganizerView)}
        stripeJs={stripeJs}
      />
    );
  }

  if (chargeStatus === "capturing") {
    return (
      <div className="rounded-lg border border-brand-line p-3">
        {header}
        <p className="mt-2 text-xs text-brand-muted">
          Everyone is committed — charging each share now. Bank debits can take a little while to settle.
        </p>
      </div>
    );
  }

  if (chargeStatus === "failed") {
    return (
      <div className="rounded-lg border border-brand-line p-3">
        {header}
        <p className="mt-2 text-xs text-brand-muted">{failureCopy(props.chargeFailureReason)}</p>
      </div>
    );
  }

  if (props.waitlisted && !active && !inFlight) {
    return (
      <div className="rounded-lg border border-brand-line p-3">
        {header}
        <p className="mt-2 text-sm font-medium text-black dark:text-zinc-50">Full — you&apos;re on the waitlist</p>
        <p className="mt-1 text-xs text-brand-muted">
          All {population} spots were taken by the first people to commit. If someone withdraws before the deadline, a
          spot opens up and you can commit here.
        </p>
      </div>
    );
  }

  if (props.alreadyContributed) {
    return (
      <div className="rounded-lg border border-brand-line p-3">
        {header}
        <p className="mt-2 text-xs text-brand-muted">Your share is already recorded.</p>
        {progress}
      </div>
    );
  }

  const total = individualAmount + fee;
  const myCap = active || inFlight ? (myMandate?.maxAmount ?? null) : null;
  const myCapTotal = myCap != null && myCap > individualAmount ? myCap + platformFee(myCap, props.platformFeePercent) : null;
  const beforeDeadline = !deadline || new Date(deadline) > new Date();
  const canWithdraw = active && !chargeStatus && beforeDeadline;
  const reauthReason =
    myMandate?.status === "canceled" &&
    myMandate.failureReason &&
    /shares changed|price rose/.test(myMandate.failureReason)
      ? myMandate.failureReason
      : null;
  const paused = Boolean(props.sharesMayChange) && !active && !inFlight;
  const iWithdrew = myMandate?.status === "canceled" && myMandate.failureReason === "canceled by participant";
  // Committed while someone else's withdrawal is pending: would the
  // authorization I already gave cover the recalculated share?
  const estimate = props.sharesMayChange && active ? (props.withdrawalEstimate ?? null) : null;
  const estimateTotal = estimate ? estimate.newShare + platformFee(estimate.newShare, props.platformFeePercent) : 0;
  const authorizedTotal = myCapTotal ?? total;

  // §5: Expected vs At most while a cushion is picked.
  const capShare = cushionCap(individualAmount, cushion);
  const capFee = platformFee(capShare, props.platformFeePercent);
  const hasCushion = capShare > individualAmount;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-[family-name:var(--font-display)] text-[30px] font-bold leading-none tracking-[-0.02em] text-foreground">
          {formatCurrency(individualAmount, currency)}
        </span>
        <span className="text-sm text-brand-muted">your share</span>
        {paused && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            may change
          </span>
        )}
      </p>

      {active || inFlight ? (
        <>
          <button
            type="button"
            disabled
            className={`${btnCommit} !h-auto min-h-12 flex-wrap gap-x-1.5 border-[1.5px] border-brand-accent !bg-brand-teal-wash px-3 py-2 leading-tight !text-brand-accent disabled:opacity-100`}
          >
            <span className="whitespace-nowrap">✓ Authorized {formatCurrency(total, currency)}</span>
            {myCapTotal != null && (
              <span className="whitespace-nowrap text-sm font-semibold">(up to {formatCurrency(myCapTotal, currency)})</span>
            )}
          </button>
          <p className="text-center text-[12.5px] text-brand-muted">
            By {METHOD_LABEL[myMandate!.paymentMethodType ?? "card"]}. Nothing&apos;s charged until everyone is committed.
          </p>
          {estimate &&
            (authorizedTotal >= estimateTotal ? (
              <div className="flex flex-col gap-0.5 rounded-xl border-[1.5px] border-brand-teal-deep bg-brand-teal-wash px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground">
                <b className="font-semibold text-brand-accent">Someone withdrew</b>
                <span>
                  If the share is recalculated for {estimate.remaining} people it becomes about {formatCurrency(estimateTotal, currency)}.
                  Your authorization of up to {formatCurrency(authorizedTotal, currency)} already covers that, so you stay committed.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 rounded-xl border-[1.5px] border-amber-300 bg-amber-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <b className="font-semibold">Someone withdrew</b>
                <span>
                  If the share is recalculated for {estimate.remaining} people it becomes about {formatCurrency(estimateTotal, currency)}.
                  Your authorization is {formatCurrency(authorizedTotal, currency)}, which doesn&apos;t cover that, so you will need to
                  re-authorize once the organizer confirms.
                </span>
              </div>
            ))}
          {props.sharesRecalculatedAt && active && !estimate && (
            <p className="text-center text-[12.5px] font-semibold text-brand-accent">
              Still covered at the new share of {formatCurrency(individualAmount, currency)}.
            </p>
          )}
          {canWithdraw && (
            <p className="text-center text-[13px] text-brand-muted">
              Changed your mind?{" "}
              <button type="button" onClick={() => setWithdrawing(true)} className={textLink}>
                Withdraw
              </button>
              {deadline && <span className="whitespace-nowrap"> before {when(deadline)}</span>}
            </p>
          )}
        </>
      ) : (
        <>
          {paused && (
            <div className="flex flex-col gap-0.5 rounded-xl border-[1.5px] border-amber-300 bg-amber-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <b className="font-semibold">Someone withdrew</b>
              <span>The organizer is updating the shares. You may be asked to commit again at a new amount.</span>
            </div>
          )}
          {reauthReason && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              Your share is now {formatCurrency(individualAmount, currency)}
              {reauthReason.startsWith("shares changed") ? " after someone withdrew" : " after the price changed"} — commit again to
              stay in.
            </p>
          )}
          <button
            type="button"
            disabled={pending || !stripeJs || paused}
            onClick={() => {
              setError(null);
              // One lightbox: traveler details first when owed (Step 1 of 2),
              // then the Stripe authorization (Step 2 of 2).
              const twoSteps = Boolean(travelerGate.config && !travelerGate.complete);
              if (twoSteps) setCheckout({ step: "details", twoSteps });
              else begin(false);
            }}
            className={btnCommit}
          >
            {paused ? "Commit paused" : pending ? "Starting…" : `Commit ${formatCurrency(individualAmount, currency)}`}
          </button>
          {!paused && (
            <p className="text-center text-[12.5px] text-brand-muted">
              {fee > 0 ? `+ ${formatCurrency(fee, currency)} Catoco fee. ` : ""}Nothing charged until funded. <TestModeBadge />
            </p>
          )}
          {iWithdrew && !paused && beforeDeadline && (
            <p className="text-center text-[13px] font-semibold text-brand-accent">
              You withdrew. You can commit again{deadline ? ` until ${when(deadline)}` : ""}.
            </p>
          )}
          {!stripeJs && <p className="text-xs text-brand-coral">Payments aren&apos;t configured in this environment.</p>}
          {myMandate?.status === "pending" && myMandate.failureReason && (
            <p className="text-xs text-brand-coral">Last attempt failed: {myMandate.failureReason}</p>
          )}
        </>
      )}

      {withdrawing && myMandate && (
        <Lightbox
          title="Withdraw your commitment?"
          subtitle={deadline ? `You can commit again until ${when(deadline)}.` : undefined}
          onClose={withdrawPending ? undefined : () => setWithdrawing(false)}
        >
          <p className="rounded-xl border-[1.5px] border-amber-300 bg-amber-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            {props.groupSplit === false ? (
              <>
                This is priced per person, so nobody else&apos;s share changes. Your place is released.
              </>
            ) : (
              <>
                The {formatCurrency(individualAmount, currency)} share is split between everyone committed. If you withdraw, this
                can&apos;t fund until the organizer recalculates for fewer people or someone else joins.
              </>
            )}
          </p>
          {withdrawError && (
            <p role="alert" className="text-xs text-brand-coral">
              {withdrawError}
            </p>
          )}
          <button
            type="button"
            disabled={withdrawPending}
            onClick={() =>
              startWithdraw(async () => {
                setWithdrawError(null);
                const res = await cancelFundingMandate(props.tripId, props.elementId, myMandate.id);
                if (res.error) {
                  setWithdrawError(res.error);
                  return;
                }
                setWithdrawing(false);
                router.refresh();
              })
            }
            className={`mt-1 h-12 w-full rounded-xl bg-foreground text-[15px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50 ${focusRing}`}
          >
            {withdrawPending ? "Withdrawing…" : "Withdraw"}
          </button>
          <button
            type="button"
            disabled={withdrawPending}
            onClick={() => setWithdrawing(false)}
            className="mx-auto rounded-md px-2 py-1.5 text-sm font-semibold text-brand-muted underline underline-offset-[3px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-teal-deep disabled:opacity-50"
          >
            Keep my commitment
          </button>
        </Lightbox>
      )}

      {checkout && (
        <Lightbox
          title={
            checkout.step === "details"
              ? `Step 1 of 2 — ${travelerGate.config?.requirement.scope === "lead" ? "Lead guest details" : "Traveler details"}`
              : checkout.twoSteps
                ? "Step 2 of 2 — Authorize payment"
                : "Authorize payment"
          }
          subtitle={[props.elementLabel, props.optionTitle].filter(Boolean).join(" · ") || undefined}
          onClose={checkout.step === "paying" ? undefined : closeCheckout}
        >
          {checkout.step === "details" && (
            <TravelerDetailsFields submitLabel="Save and continue" onCancel={closeCheckout} onSaved={() => begin(true)} />
          )}
          {checkout.step === "starting" &&
            (error ? (
              <>
                <p className="text-sm text-brand-coral">{error}</p>
                <button type="button" className={`h-9 w-fit self-end px-3 text-xs ${btnSecondary}`} onClick={closeCheckout}>
                  Close
                </button>
              </>
            ) : (
              <p className="text-sm text-brand-muted">Preparing secure payment…</p>
            ))}
          {(checkout.step === "pay" || checkout.step === "paying") && setup && stripeJs && (
            <>
              {hasCushion ? (
                <table className="w-full rounded-xl border border-brand-line bg-brand-surface text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs text-brand-muted">
                      <th className="px-3.5 pb-1 pt-2.5 font-semibold" />
                      <th className="px-2 pb-1 pt-2.5 text-right font-semibold">Expected</th>
                      <th className="px-3.5 pb-1 pt-2.5 text-right font-semibold">At most</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3.5 py-1 text-brand-muted">Your share</td>
                      <td className="px-2 py-1 text-right">{formatCurrency(individualAmount, currency)}</td>
                      <td className="px-3.5 py-1 text-right">{formatCurrency(capShare, currency)}</td>
                    </tr>
                    <tr className="text-brand-muted">
                      <td className="px-3.5 py-1">Catoco fee</td>
                      <td className="px-2 py-1 text-right">{formatCurrency(fee, currency)}</td>
                      <td className="px-3.5 py-1 text-right">≈ {formatCurrency(capFee, currency)}</td>
                    </tr>
                    <tr className="border-t border-brand-line font-bold text-foreground">
                      <td className="px-3.5 pb-2.5 pt-1.5">Total to authorize</td>
                      <td className="px-2 pb-2.5 pt-1.5 text-right">{formatCurrency(total, currency)}</td>
                      <td className="px-3.5 pb-2.5 pt-1.5 text-right">{formatCurrency(capShare + capFee, currency)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <div className="rounded-xl border border-brand-line bg-brand-surface px-3.5 py-2.5 text-sm">
                  <ShareBreakdown share={individualAmount} percent={props.platformFeePercent} currency={currency} showPercent={false} />
                </div>
              )}

              {props.cushionAllowed ? (
                <fieldset
                  className="flex flex-col gap-2 rounded-xl border border-brand-line bg-brand-surface px-3.5 py-3"
                  disabled={checkout.step === "paying"}
                >
                  <legend className="sr-only">Protect against price changes</legend>
                  <b aria-hidden className="text-[14.5px] font-semibold text-foreground">
                    Protect against price changes
                  </b>
                  <p className="text-[12.5px] leading-relaxed text-brand-muted">
                    Prices can move before booking. Choose how much more you&apos;re willing to authorize. You&apos;re only charged the
                    actual amount, and the Catoco fee follows it.
                  </p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Extra amount to authorize">
                    {[...options, { key: "custom", label: "Custom", choice: { kind: "none" } as CushionChoice, recommended: false }].map(
                      (o) => (
                        <button
                          key={o.key}
                          type="button"
                          role="radio"
                          aria-checked={cushionKey === o.key}
                          onClick={() => setCushionKey(o.key)}
                          className={`flex min-h-[38px] min-w-[70px] flex-1 flex-col items-center justify-center rounded-xl border-[1.5px] px-2 py-1 text-[13.5px] font-semibold transition-colors ${focusRing} ${
                            cushionKey === o.key
                              ? "border-brand-accent bg-brand-teal-wash text-brand-accent"
                              : "border-brand-line text-foreground hover:border-brand-accent"
                          }`}
                        >
                          {o.label}
                          {o.recommended && <span className="text-[10.5px] font-medium text-brand-accent">recommended</span>}
                        </button>
                      ),
                    )}
                  </div>
                  {cushionKey === "custom" && (
                    <label className="flex flex-col gap-1 text-[13px] font-semibold text-foreground">
                      Extra amount ({currency})
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={individualAmount}
                        step="1"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder="e.g. 50"
                        className={`h-10 w-full ${fieldClass}`}
                      />
                    </label>
                  )}
                </fieldset>
              ) : (
                <p className="text-[13px] text-brand-muted">
                  The organizer confirmed this price. It is the amount you will be charged.
                </p>
              )}


              <div className="flex flex-col gap-1.5 rounded-xl border-[1.5px] border-brand-teal-deep bg-brand-teal-wash px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground">
                <b className="font-semibold text-brand-accent">You are authorizing a payment. Nothing is charged today.</b>
                <span>
                  {formatCurrency(total, currency)} will be charged when everyone is committed
                  {props.requiredAmount ? ` and the funding goal of ${formatCurrency(props.requiredAmount, currency)} is met` : ""}. If
                  that isn&apos;t reached by {deadline ? when(deadline) : "the funding deadline"}, the authorization is released and
                  you pay nothing.
                </span>
              </div>
              <Elements
                stripe={stripeJs}
                options={{
                  clientSecret: setup.clientSecret,
                  appearance: {
                    theme:
                      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
                        ? "night"
                        : "stripe",
                    variables: { colorPrimary: "#0f766e", borderRadius: "8px" },
                  },
                }}
              >
                {setup.sepaUnavailable && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    SEPA Direct Debit isn&apos;t enabled on this Stripe account yet — card only for now.
                  </p>
                )}
                <SetupForm
                  {...props}
                  mandateId={setup.mandateId}
                  methods={setup.methods}
                  total={total}
                  beforeConfirm={async () => {
                    // §5: save the cushion picked above on this authorization.
                    const res = await setMandateCushion(setup.mandateId, cushion);
                    return res.error ?? null;
                  }}
                  onSubmitting={(busy) => setCheckout({ step: busy ? "paying" : "pay", twoSteps: checkout.twoSteps })}
                  onDone={() => {
                    // Straight back to the card, now showing "✓ Authorized".
                    setCheckout(null);
                    setSetup(null);
                    router.refresh();
                  }}
                  onCancel={closeCheckout}
                />
              </Elements>
            </>
          )}
        </Lightbox>
      )}
      {error && !checkout && <p className="text-xs text-brand-coral">{error}</p>}
    </div>
  );
}

function SetupForm({
  tripId,
  elementId,
  mandateId,
  methods,
  onDone,
  onCancel,
  onSubmitting,
  beforeConfirm,
  total,
  currency,
}: MandatePanelProps & {
  mandateId: string;
  methods: string[];
  /** share + fee — the amount being authorized */
  total: number;
  /** runs first on Authorize (saves the cushion); returns an error message or null */
  beforeConfirm?: () => Promise<string | null>;
  onDone: () => void;
  onCancel: () => void;
  /** lets the lightbox lock itself while Stripe is confirming */
  onSubmitting: (busy: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setSubmitting(true);
        onSubmitting(true);
        setError(null);
        const pre = beforeConfirm ? await beforeConfirm() : null;
        if (pre) {
          setError(pre);
          setSubmitting(false);
          onSubmitting(false);
          return;
        }
        const { error: confirmError } = await stripe.confirmSetup({
          elements,
          // Cards (incl. 3DS in a modal) and SEPA complete in place; this is
          // only used by a method that must leave the page, and the webhook
          // activates the mandate either way.
          confirmParams: { return_url: `${window.location.origin}/trips/${tripId}/elements/${elementId}` },
          redirect: "if_required",
        });
        if (confirmError) {
          setError(confirmError.message ?? "That didn't go through. Check the details and try again.");
          setSubmitting(false);
          onSubmitting(false);
          return;
        }
        const res = await syncFundingMandate(tripId, elementId, mandateId);
        setSubmitting(false);
        if (res.error) {
          onSubmitting(false);
          setError(res.error);
          return;
        }
        onDone();
      }}
    >
      <PaymentElement options={{ paymentMethodOrder: methods, layout: "tabs" }} />
      {error && (
        <p role="alert" className="text-xs text-brand-coral">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className={`mt-1 h-12 w-full text-[15px] font-semibold ${btnPrimary} ${focusRing}`}
      >
        {submitting ? "Authorizing…" : `Authorize ${formatCurrency(total, currency)}`}
      </button>
      <button
        type="button"
        disabled={submitting}
        onClick={onCancel}
        className={`mx-auto px-2 py-1.5 text-sm ${textLink}`}
      >
        Cancel
      </button>
      <p className="text-center text-xs text-brand-muted">
        By authorizing, you allow Catoco to charge this amount at funding. You can withdraw until the deadline.
      </p>
    </form>
  );
}
