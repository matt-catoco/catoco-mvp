"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { cancelFundingMandate, startFundingMandate, syncFundingMandate } from "./payment-actions";
import { btnPrimary, btnSecondary, labelClass } from "@/lib/ui";
import { platformFee } from "@/lib/platform-fee";
import { formatCurrency } from "@/lib/trip-elements";
import { ShareBreakdown } from "@/components/share-breakdown";
import { HoldPhasePanel, type RetryStatus } from "./retry-panel";

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
  /** Authorized "up to" (share + cushion at the time). */
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
};

const METHOD_LABEL = { card: "card", sepa_debit: "SEPA Direct Debit" } as const;

function failureCopy(reason: string | null): string {
  if (reason === "not_fully_mandated") {
    return "Not everyone authorized their share by the deadline, so nobody was charged.";
  }
  if (reason === "retry_expired") {
    return "One payment couldn't be fixed in time, so the group's holds were released — nobody was charged.";
  }
  return "A payment failed at the final step after others had gone through, so the pool was called off — those charges are being refunded automatically.";
}

/**
 * The participant-facing "Fund it" box for mandate-based funding (flow #4).
 * Authorize now via Stripe's Payment Element (SetupIntent — nothing is
 * charged), get charged at the funding deadline only if the whole group
 * authorized. Stripe TEST MODE only.
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
  const stripeJs = useMemo(() => getStripeJs(), []);

  const deadlineLabel = deadline ? new Date(deadline).toLocaleDateString() : null;
  const active = myMandate?.status === "active";
  const inFlight = myMandate?.status === "charging" || myMandate?.status === "charge_succeeded";

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-black dark:text-zinc-50">Fund it</span>
      <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Test mode
      </span>
    </div>
  );

  const progress = (
    <p className="mt-2 text-xs text-brand-muted">
      {covered} of {population} authorized
      {deadlineLabel ? ` · charges run ${deadlineLabel}, only if everyone's in` : ""}
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
          Everyone&apos;s hold is in — charging each share now. Bank debits can take a little while to settle.
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
          All {population} spots were taken by the first people to commit. If someone cancels before the
          deadline, a spot opens up and you can authorize here.
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

  return (
    <div className="rounded-lg border border-brand-line p-3">
      {header}
      <div className="mt-2">
        <span className={labelClass}>Your share</span>
        <ShareBreakdown share={individualAmount} percent={props.platformFeePercent} currency={currency} />
        {(() => {
          const upTo = active || inFlight ? myMandate?.maxAmount : props.capAmount;
          return upTo != null && upTo > individualAmount ? (
            <p className="text-[11px] text-brand-muted">
              {active || inFlight ? "Authorized" : "You'll authorize"} up to{" "}
              {formatCurrency(upTo + platformFee(upTo, props.platformFeePercent), currency)}
              {fee > 0 ? " incl. fee" : ""} in case the price moves before booking — you&apos;re only charged the
              actual share{fee > 0 ? " plus fee" : ""}.
            </p>
          ) : null;
        })()}
      </div>

      {active || inFlight ? (
        <>
          <p className="mt-2 text-xs text-brand-muted">
            Authorized by {METHOD_LABEL[myMandate!.paymentMethodType ?? "card"]}. Nothing&apos;s been
            charged — you&apos;ll only be charged at the deadline, and only if the whole group
            authorizes.
          </p>
          {progress}
          {active && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await cancelFundingMandate(props.tripId, props.elementId, myMandate!.id);
                  if (res.error) {
                    setError(res.error);
                    return;
                  }
                  router.refresh();
                });
              }}
              className="mt-2 text-xs text-red-600 underline hover:text-red-700 disabled:opacity-40 dark:text-red-400"
            >
              {pending ? "Canceling…" : "Cancel my authorization"}
            </button>
          )}
        </>
      ) : setup && stripeJs ? (
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
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              SEPA Direct Debit isn&apos;t enabled on this Stripe account yet — card only for now.
            </p>
          )}
          <SetupForm
            {...props}
            mandateId={setup.mandateId}
            methods={setup.methods}
            onDone={() => {
              setSetup(null);
              router.refresh();
            }}
          />
        </Elements>
      ) : (
        <>
          {progress}
          <button
            type="button"
            disabled={pending || !stripeJs}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await startFundingMandate(props.tripId, props.elementId, props.fundingRequestId);
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
              });
            }}
            className={`mt-2 h-9 px-3 text-xs ${btnPrimary}`}
          >
            {pending ? "Starting…" : "Authorize my share"}
          </button>
          {!stripeJs && (
            <p className="mt-1 text-xs text-red-500">Payments aren&apos;t configured in this environment.</p>
          )}
          {myMandate?.status === "pending" && myMandate.failureReason && (
            <p className="mt-1 text-xs text-red-500">Last attempt failed: {myMandate.failureReason}</p>
          )}
        </>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function SetupForm({
  tripId,
  elementId,
  mandateId,
  methods,
  onDone,
}: MandatePanelProps & { mandateId: string; methods: string[]; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setSubmitting(true);
        setError(null);
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
          return;
        }
        const res = await syncFundingMandate(tripId, elementId, mandateId);
        setSubmitting(false);
        if (res.error) {
          setError(res.error);
          return;
        }
        onDone();
      }}
    >
      <PaymentElement options={{ paymentMethodOrder: methods, layout: "tabs" }} />
      <button type="submit" disabled={!stripe || submitting} className={`h-9 px-3 text-xs ${btnPrimary}`}>
        {submitting ? "Authorizing…" : "Authorize — don't charge yet"}
      </button>
      <button
        type="button"
        disabled={submitting}
        onClick={onDone}
        className={`h-8 px-3 text-xs ${btnSecondary}`}
      >
        Not now
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
