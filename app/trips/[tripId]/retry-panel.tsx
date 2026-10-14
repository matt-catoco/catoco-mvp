"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  completeRetryPaymentMethod,
  extendPaymentRetry,
  getRetryAuthentication,
  startRetryPaymentMethod,
  syncRetryAuthentication,
} from "./payment-actions";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import { formatCurrency } from "@/lib/trip-elements";
import { TestModeBadge } from "./test-mode-badge";

export type RetryStatus = {
  waiting: number;
  held: number;
  total: number;
  retryDeadline: string | null;
  holdCapAt: string | null;
};

function timeLeft(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "time's up";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

/**
 * Funding-deadline holds phase (authorize-then-capture). Everyone sees where
 * the group stands; a participant whose hold failed gets the fix that
 * matches the failure (new payment method vs. confirming with their bank);
 * the organizer can extend the window.
 */
export function HoldPhasePanel({
  tripId,
  elementId,
  fundingRequestId,
  currency,
  share,
  myStatus,
  myRetryReason,
  myMandateId,
  retry,
  isOrganizerView,
  stripeJs,
}: {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  currency: string;
  share: number;
  myStatus: string | null;
  myRetryReason: string | null;
  myMandateId: string | null;
  retry: RetryStatus | null;
  isOrganizerView: boolean;
  stripeJs: Promise<StripeJs | null> | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newMethod, setNewMethod] = useState<{ clientSecret: string; methods: string[] } | null>(null);

  const waiting = retry?.waiting ?? 0;
  const left = timeLeft(retry?.retryDeadline ?? null);
  const iAmWaiting = myStatus === "awaiting_retry" && myMandateId;

  const groupLine =
    waiting > 0 ? (
      <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        Waiting on {waiting} participant{waiting === 1 ? "" : "s"} to update payment{left ? ` — ${left}` : ""}. Everyone
        else is committed, not charged.
      </p>
    ) : (
      <p className="mt-2 text-xs text-brand-muted">
        Committing — {retry?.held ?? 0} of {retry?.total ?? 0} in. Nobody is charged until everyone is committed.
      </p>
    );

  return (
    // Sits directly in the element card (the header chip already says
    // "Committing"), like the mockup — no box-in-a-box.
    <div className="flex flex-col">
      <div className="flex justify-end empty:hidden">
        <TestModeBadge />
      </div>

      {myStatus === "held" && (
        <div className="mt-2 flex flex-col gap-0.5 rounded-xl border-[1.5px] border-brand-teal-deep bg-brand-teal-wash px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground">
          <b className="font-semibold text-brand-accent">✓ You&apos;re committed</b>
          <span>
            {formatCurrency(share, currency)} is authorized, not charged. You will be charged once everyone is committed.
          </span>
        </div>
      )}

      {iAmWaiting && myRetryReason === "authentication_required" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm font-medium text-black dark:text-zinc-50">Your bank needs you to confirm</p>
          <p className="text-xs text-brand-muted">
            Everyone else is waiting on you{left ? ` (${left})` : ""}. Confirming completes your commitment. Nothing is charged
            until everyone is committed.
          </p>
          <button
            type="button"
            disabled={pending || !stripeJs}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await getRetryAuthentication(tripId, elementId, myMandateId!);
                if (res.error || !res.clientSecret) return setError(res.error ?? "Couldn't start the confirmation.");
                const stripe = await stripeJs;
                if (!stripe) return setError("Payments aren't configured in this environment.");
                const { error: authError } = await stripe.confirmCardPayment(res.clientSecret, {
                  payment_method: res.paymentMethodId,
                });
                if (authError) return setError(authError.message ?? "The bank didn't confirm it. Try again.");
                const sync = await syncRetryAuthentication(tripId, elementId, myMandateId!);
                if (sync.error) return setError(sync.error);
                router.refresh();
              });
            }}
            className={`h-9 self-start px-3 text-xs ${btnPrimary}`}
          >
            {pending ? "Confirming…" : "Confirm with my bank"}
          </button>
        </div>
      )}

      {iAmWaiting && myRetryReason !== "authentication_required" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm font-medium text-black dark:text-zinc-50">Your card was declined</p>
          <p className="text-xs text-brand-muted">
            Add a different card or bank account{left ? ` (${left})` : ""} to complete your commitment of{" "}
            {formatCurrency(share, currency)}. Nothing is charged until everyone is committed.
          </p>
          {newMethod && stripeJs ? (
            <Elements
              stripe={stripeJs}
              options={{ clientSecret: newMethod.clientSecret, appearance: { variables: { colorPrimary: "#0f766e", borderRadius: "8px" } } }}
            >
              <NewMethodForm
                tripId={tripId}
                elementId={elementId}
                mandateId={myMandateId!}
                methods={newMethod.methods}
                onDone={() => {
                  setNewMethod(null);
                  router.refresh();
                }}
              />
            </Elements>
          ) : (
            <button
              type="button"
              disabled={pending || !stripeJs}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await startRetryPaymentMethod(tripId, elementId, myMandateId!);
                  if (res.error || !res.clientSecret) return setError(res.error ?? "Couldn't start. Try again.");
                  setNewMethod({ clientSecret: res.clientSecret, methods: res.paymentMethodTypes ?? ["card"] });
                });
              }}
              className={`h-9 self-start px-3 text-xs ${btnPrimary}`}
            >
              {pending ? "Starting…" : "Use a different payment method"}
            </button>
          )}
        </div>
      )}

      {!(isOrganizerView && waiting > 0) && groupLine}

      {isOrganizerView && waiting > 0 && (
        <div className="mt-2 flex flex-col gap-2 rounded-xl border-[1.5px] border-amber-300 bg-amber-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <b className="font-semibold">
            {waiting === 1 ? "1 person hasn't" : `${waiting} people haven't`} committed
          </b>
          <span>
            If everyone isn&apos;t committed in time, authorizations are released and the funding date has to be reset. A final
            nudge gives {waiting === 1 ? "them" : "everyone waiting"} 24 more hours.
          </span>
          <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await extendPaymentRetry(tripId, elementId, fundingRequestId, 24);
                if (res.error) return setError(res.error);
                router.refresh();
              });
            }}
            className={`h-9 px-3 text-sm ${btnSecondary}`}
          >
            {pending ? "Sending…" : "Send final nudge (+24h)"}
          </button>
          <span className="text-[11px]">Card authorizations last about a week, so this is capped.</span>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function NewMethodForm({
  tripId,
  elementId,
  mandateId,
  methods,
  onDone,
}: {
  tripId: string;
  elementId: string;
  mandateId: string;
  methods: string[];
  onDone: () => void;
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
        setError(null);
        const { error: confirmError, setupIntent } = await stripe.confirmSetup({
          elements,
          confirmParams: { return_url: `${window.location.origin}/trips/${tripId}/elements/${elementId}` },
          redirect: "if_required",
        });
        if (confirmError || !setupIntent) {
          setError(confirmError?.message ?? "That didn't go through. Check the details and try again.");
          setSubmitting(false);
          return;
        }
        const res = await completeRetryPaymentMethod(tripId, elementId, mandateId, setupIntent.id);
        setSubmitting(false);
        if (res.error) return setError(res.error);
        onDone();
      }}
    >
      <PaymentElement options={{ paymentMethodOrder: methods, layout: "tabs" }} />
      <button type="submit" disabled={!stripe || submitting} className={`h-9 px-3 text-xs ${btnPrimary}`}>
        {submitting ? "Saving…" : "Save and commit"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
