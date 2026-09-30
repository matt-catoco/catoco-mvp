"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { cancelFundingMandate, startFundingMandate, syncFundingMandate } from "./payment-actions";
import { btnPrimary, btnSecondary, labelClass } from "@/lib/ui";
import { formatCurrency } from "@/lib/trip-elements";
import { estimateFee, SEPA_FLAT } from "@/lib/stripe/fees";

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
  status: "pending" | "active" | "charging" | "charge_succeeded" | "charge_failed" | "canceled" | "refunded";
  paymentMethodType: "card" | "sepa_debit" | null;
  failureReason: string | null;
};

export type MandatePanelProps = {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  currency: string;
  individualAmount: number;
  deadline: string | null;
  chargeStatus: "charging" | "charged" | "failed" | null;
  chargeFailureReason: string | null;
  myMandate: MyMandateInfo | null;
  population: number;
  covered: number;
  /** Already covered by a pre-Stripe manual contribution. */
  alreadyContributed: boolean;
};

const METHOD_LABEL = { card: "card", sepa_debit: "SEPA Direct Debit" } as const;

function failureCopy(reason: string | null): string {
  if (reason === "not_fully_mandated") {
    return "Not everyone authorized their share by the deadline, so nobody was charged.";
  }
  return "At least one charge didn't go through, so the whole pool was called off — any charges that did succeed are being refunded automatically.";
}

/**
 * The participant-facing "Fund it" box for mandate-based funding (flow #4).
 * Authorize now via Stripe's Payment Element (SetupIntent — nothing is
 * charged), get charged at the funding deadline only if the whole group
 * authorized. Stripe TEST MODE only.
 */
export function MandatePanel(props: MandatePanelProps) {
  const { currency, individualAmount, deadline, chargeStatus, myMandate, population, covered } = props;
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

  const isEur = currency === "EUR";
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
      <div className="rounded-lg border border-brand-line p-3">
        {header}
        <p className="mt-2 text-xs text-brand-muted">
          The deadline hit and everyone was authorized — charging each share now. Bank debits can
          take a little while to settle.
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
        <p className="text-sm font-medium text-black dark:text-zinc-50">
          {formatCurrency(individualAmount, currency)}
        </p>
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
          <FeeNote currency={currency} amount={individualAmount} isEur={isEur} />
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

/** Fee display branches by method: percentage for cards, flat for SEPA. */
function FeeNote({ currency, amount, isEur }: { currency: string; amount: number; isEur: boolean }) {
  const cardFee = estimateFee(amount, "card");
  return (
    <p className="mt-1 text-[11px] text-brand-muted">
      {isEur ? (
        <>
          SEPA Direct Debit is recommended: {formatCurrency(SEPA_FLAT, currency)} flat processing fee vs.
          about {formatCurrency(cardFee, currency)} by card (1.5% + €0.25).
        </>
      ) : (
        <>Card processing fee: about {formatCurrency(cardFee, currency)} (est., 1.5% + 0.25).</>
      )}
    </p>
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
