"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refundEveryone } from "./payment-actions";
import { btnSecondary } from "@/lib/ui";
import { formatCurrency } from "@/lib/trip-elements";

/** Per-participant payment state (flow #4), derived server-side from each
 * person's latest mandate + their Stripe contribution. */
export type PaymentState =
  | "not_authorized"
  | "started"
  | "authorized"
  | "charging"
  | "paid"
  | "used"
  | "charge_failed"
  | "refund_pending"
  | "refunded"
  | "canceled";

export type PaymentRosterEntry = {
  userId: string;
  displayName: string;
  state: PaymentState;
  method: "card" | "sepa_debit" | null;
  detail: string | null;
};

const STATE_LABEL: Record<PaymentState, string> = {
  not_authorized: "Not authorized yet",
  started: "Started, not finished",
  authorized: "Authorized — not charged",
  charging: "Charging…",
  paid: "Paid",
  used: "Paid · used for booking",
  charge_failed: "Charge failed",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  canceled: "Authorization canceled",
};

// Solid = settled money, dashed = pending/open — the brand's own
// open-vs-locked motif, reused for payment state.
const STATE_TONE: Record<PaymentState, string> = {
  not_authorized: "border-dashed border-brand-line text-brand-muted",
  started: "border-dashed border-brand-line text-brand-muted",
  authorized: "border-dashed border-brand-teal-deep text-brand-teal-deep",
  charging: "border-dashed border-amber-500 text-amber-700 dark:text-amber-400",
  paid: "border-brand-teal-deep bg-brand-teal-deep text-white",
  used: "border-foreground bg-foreground text-background",
  charge_failed: "border-red-500 text-red-600 dark:text-red-400",
  refund_pending: "border-dashed border-amber-500 text-amber-700 dark:text-amber-400",
  refunded: "border-brand-line bg-brand-line text-foreground",
  canceled: "border-dashed border-brand-line text-brand-muted",
};

const METHOD = { card: "card", sepa_debit: "SEPA" } as const;

export function PaymentRoster({ entries, isOrganizerView }: { entries: PaymentRosterEntry[]; isOrganizerView: boolean }) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-3 border-t border-brand-line pt-3">
      <span className="text-xs font-medium text-black dark:text-zinc-50">
        {isOrganizerView ? "Payments" : "Your payment"}
      </span>
      <ul className="mt-2 flex flex-col gap-1.5">
        {entries.map((e) => (
          <li key={e.userId} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate">
              {e.displayName}
              {e.method && <span className="text-brand-muted"> · {METHOD[e.method]}</span>}
              {e.detail && <span className="text-brand-muted"> · {e.detail}</span>}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATE_TONE[e.state]}`}
            >
              {STATE_LABEL[e.state]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Organizer "Refund everyone" for a pool holding real Stripe money — the
 * way to unwind a funded element/trip before cancelling it. Two-step
 * confirm inline (no browser dialog).
 */
export function RefundEveryone({
  tripId,
  elementId,
  fundingRequestId,
  heldAmount,
  heldCount,
  currency,
  refundRequestedAt,
  booked,
}: {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  heldAmount: number;
  heldCount: number;
  currency: string;
  refundRequestedAt: string | null;
  booked: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (refundRequestedAt) {
    return (
      <div className="mt-3 border-t border-brand-line pt-3">
        <p className="text-xs text-brand-muted">
          Refunding everyone — {heldCount} payment{heldCount === 1 ? "" : "s"} still on the way back. This
          shows Refunded once Stripe confirms the last one.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-1 text-xs underline text-brand-muted hover:text-foreground"
        >
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-brand-line pt-3">
      <p className="text-xs text-brand-muted">
        {formatCurrency(heldAmount, currency)} from {heldCount} {heldCount === 1 ? "person is" : "people are"} held
        here. To cancel this{booked ? " (only if the booking itself was cancelled)" : ""}, refund everyone
        first — the element and trip can be deleted once it shows Refunded.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`mt-1.5 h-8 px-3 text-xs ${btnSecondary}`}
        >
          Refund everyone
        </button>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await refundEveryone(tripId, elementId, fundingRequestId);
                if (res.error) {
                  setError(res.error);
                  return;
                }
                setConfirming(false);
                router.refresh();
              });
            }}
            className="h-8 rounded-lg bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            {pending ? "Refunding…" : `Yes, refund ${formatCurrency(heldAmount, currency)}`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className={`h-8 px-3 text-xs ${btnSecondary}`}
          >
            Keep it
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
