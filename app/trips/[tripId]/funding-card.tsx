"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addFundingContribution,
  markFundingRequestRefunded,
  reassignPurchaser,
  resolveFundingOutcome,
  setFundingDeadline,
} from "./actions";
import { btnCommit, btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";
import { platformFee } from "@/lib/platform-fee";
import { formatCurrency, formatDate } from "@/lib/trip-elements";
import { MandatePanel, type MandatePanelProps } from "./mandate-panel";
import { ShareBreakdown } from "@/components/share-breakdown";
import { PriceCheck, type PriceInfo } from "./price-check";
import { PaymentRoster, RefundEveryone, type PaymentRosterEntry } from "./payment-status";
import { ReadyToBook } from "./ready-to-book";
import { WithdrawalNotice, type WithdrawalInfo } from "./withdrawal-notice";
import { Lightbox, useTravelerGate } from "./traveler-details";
import { useElementPageUI } from "./element-header";
import type { BookingDraft } from "./booking-record-form";
import type { ReactNode } from "react";

const field = `h-9 ${fieldClass}`;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

export type FundingRequestInfo = {
  id: string;
  requiredAmount: number;
  // §5: the caller's fixed share — computed once at funding_request
  // creation (required_amount / the bundle's full opted-in participant
  // union), never redistributed. Every contribution is locked to exactly
  // this, bundled or not.
  individualAmount: number;
  /** Catoco fee on top of the share (snapshot on the request; 0 = none). */
  platformFeePercent: number;
  collected: number;
  status: "collecting" | "ready_to_purchase" | "booked";
  deadline: string | null;
  purchaserId: string | null;
  purchaserName: string;
  actualAmountPaid: number | null;
  // §3 of the trip-settings prompt: a manual overlay flag standing in for
  // real refund processing until payment integration exists. Also what
  // delete_trip() reads server-side to decide whether this funding_request
  // is still blocking the trip from being deleted.
  refundedAt: string | null;
  /** Flow #4 charge-batch state (Stripe mandates). null = not started. */
  chargeStatus: "charging" | "capturing" | "charged" | "failed" | null;
};

/** Present only when Stripe is configured in this environment — the
 * mandate panel then replaces the manual Commit ledger. */
export type FundingPayments = {
  panel: Omit<
    MandatePanelProps,
    "tripId" | "elementId" | "fundingRequestId" | "currency" | "individualAmount" | "platformFeePercent" | "deadline" | "chargeStatus"
  >;
  /** Everyone's payment state for the organizer; just the viewer's own row otherwise. */
  roster: PaymentRosterEntry[];
  isOrganizerView: boolean;
  /** Organizers: someone withdrew and Commit is paused (null otherwise). */
  withdrawals?: WithdrawalInfo | null;
  /** Real Stripe money currently held on this request (unrefunded charges). */
  heldAmount: number;
  heldCount: number;
  refundRequestedAt: string | null;
};

export type FundingRosterEntry = { userId: string; displayName: string };

/** §6: one row of the combined bundle view — every OTHER element sharing
 * this funding_request besides the one this card is rendered on. */
export type BundleMemberInfo = {
  elementId: string;
  label: string;
  type: string;
  title: string;
  price: number | null;
  currency?: string;
};

/**
 * The funding lifecycle for one locked element (flow #4) — required vs
 * collected, a manual contribution ledger (not a real charge — the
 * contribution-charge ticket swaps this for Stripe without touching the
 * schema), the deadline, and once ready, the purchaser's Booked/
 * Unavailable report. Real funding_request data throughout; no
 * automated viability checking exists yet (no Travelpayouts/Viator
 * integration), so "still viable?" is always a manual answer here.
 */
export function FundingCard({
  tripId,
  elementId,
  currentUserId,
  canManage,
  funding,
  roster,
  currency = "USD",
  members = [],
  payments,
  priceInfo,
  booking = null,
  elementLabel,
  optionTitle,
}: {
  tripId: string;
  elementId: string;
  currentUserId: string;
  canManage: boolean;
  funding: FundingRequestInfo;
  roster: FundingRosterEntry[];
  currency?: string;
  /** §6: the OTHER elements sharing this funding_request, when it's a real
   * bundle (empty for the common single-element case) — rendered as one
   * combined list above the funding status instead of separate per-element
   * prompts. */
  members?: BundleMemberInfo[];
  payments?: FundingPayments;
  /** Price cushion: current price, cushion, recheck/update (locked elements). */
  priceInfo?: PriceInfo;
  /** Booking record pieces — present only for people who can record the booking. */
  booking?: {
    draft: BookingDraft;
    roster: { userId: string; displayName: string }[];
    showIncidentals: boolean;
    amountFromCard: number | null;
    alreadyBooked: boolean;
    optionValue: Record<string, unknown>;
    travelers?: ReactNode;
  } | null;
  /** For the Commit modal's subtitle: "Accommodations · Casa Mare". */
  elementLabel?: string;
  optionTitle?: string;
}) {
  const router = useRouter();
  // Functional purchaser access stays a separate, user-ID-based check —
  // unaffected by §12's visibility change (the "Purchaser: X" label and the
  // reassignment control move into the canManage-gated section below, but a
  // regular-participant purchaser still needs contribute/Mark booked/Report
  // unavailable to work for them).
  const isPurchaser = funding.purchaserId === currentUserId;
  const canAct = canManage || isPurchaser;

  const [reassignPending, startReassign] = useTransition();
  const [reassignError, setReassignError] = useState<string | null>(null);

  const [contribError, setContribError] = useState<string | null>(null);
  const [contribPending, startContrib] = useTransition();
  const travelerGate = useTravelerGate();
  // Whether the caller has already recorded their contribution — a second
  // Commit click would just hit add_funding_contribution's "already
  // contributed" rejection, so this disables the button instead of letting
  // that round-trip happen. Best-effort from the roster-side data this
  // component already has (no full contributor list is passed down); a
  // stale "not yet contributed" briefly after a real double-submit is
  // caught server-side regardless.
  const [justContributed, setJustContributed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // The displayed deadline always reads the saved prop; `deadline` is only
  // the editor's draft, re-seeded from the saved value each time it opens.
  const savedDeadline = funding.deadline?.slice(0, 10) ?? "";
  const [deadline, setDeadline] = useState(savedDeadline);
  // Shared with the header's "⋯ → Set a new deadline" on the element page.
  const ui = useElementPageUI();
  const [localEditingDeadline, setLocalEditingDeadline] = useState(false);
  const editingDeadline = ui ? ui.deadlineEditorOpen : localEditingDeadline;
  const setEditingDeadline = ui ? ui.setDeadlineEditorOpen : setLocalEditingDeadline;
  const [deadlinePending, startDeadline] = useTransition();
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

  const [resolvePending, startResolve] = useTransition();
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [refundPending, startRefund] = useTransition();
  const [refundError, setRefundError] = useState<string | null>(null);


  const deadlinePassed = funding.deadline ? new Date(funding.deadline) <= new Date() : false;
  const isFullyFunded = funding.collected >= funding.requiredAmount;
  const pct = funding.requiredAmount > 0
    ? Math.min(100, Math.round((funding.collected / funding.requiredAmount) * 100))
    : 0;
  // Mirrors delete_trip()'s own block condition exactly (status ready_to_
  // purchase/booked, or any real money already collected) — shown whenever
  // this funding_request is actually what's standing between the trip and
  // being deletable, not on every funding_request unconditionally.
  const isBlocking = !funding.refundedAt && (funding.status !== "collecting" || funding.collected > 0);

  const purchaserSelect = (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>Purchaser</span>
      <select
        className={`${field} w-40`}
        value={funding.purchaserId ?? ""}
        disabled={reassignPending}
        onChange={(e) => {
          const next = e.target.value;
          if (!next || next === funding.purchaserId) return;
          setReassignError(null);
          startReassign(async () => {
            const res = await reassignPurchaser(tripId, elementId, funding.id, next);
            if (res.error) {
              setReassignError(res.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        {!funding.purchaserId && <option value="">Unassigned</option>}
        {roster.map((r) => (
          <option key={r.userId} value={r.userId}>
            {r.userId === currentUserId ? "You" : r.displayName}
          </option>
        ))}
      </select>
    </label>
  );
  const refundControls = (
    funding.refundedAt ? (
      <p className="mt-3 border-t border-brand-line pt-3 text-xs text-brand-muted">
        Refunded {new Date(funding.refundedAt).toLocaleDateString()}
      </p>
    ) : payments && (payments.heldCount > 0 || payments.refundRequestedAt) ? (
      // Real Stripe money on this pool: the only way out is actually
      // returning it — the manual flag below refuses in this case.
      canManage &&
      funding.chargeStatus !== "charging" && funding.chargeStatus !== "capturing" && (
        <RefundEveryone
          tripId={tripId}
          elementId={elementId}
          fundingRequestId={funding.id}
          heldAmount={payments.heldAmount}
          heldCount={payments.heldCount}
          currency={currency}
          refundRequestedAt={payments.refundRequestedAt}
          booked={funding.status === "booked"}
        />
      )
    ) : (
      canManage &&
      isBlocking && (
        <div className="mt-3 border-t border-brand-line pt-3">
          <p className="text-xs text-brand-muted">
            Money is on the line here — this blocks the trip from being deleted until it&apos;s
            settled up and marked refunded.
          </p>
          <button
            type="button"
            disabled={refundPending}
            onClick={() => {
              setRefundError(null);
              startRefund(async () => {
                const res = await markFundingRequestRefunded(tripId, elementId, funding.id);
                if (res.error) {
                  setRefundError(res.error);
                  return;
                }
                router.refresh();
              });
            }}
            className={`mt-1.5 h-8 px-3 text-xs ${btnSecondary}`}
          >
            {refundPending ? "Marking…" : "Mark as refunded"}
          </button>
          {refundError && <p className="mt-1 text-xs text-red-500">{refundError}</p>}
        </div>
      )
    )
  );
  const manualFee = platformFee(funding.individualAmount, funding.platformFeePercent);
  const manualTotal = funding.individualAmount + manualFee;
  // "N of M committed": the mandate summary when Stripe runs this pool;
  // otherwise an estimate from collected / share.
  const committedOf = payments
    ? payments.panel.population > 0
      ? { n: payments.panel.covered, m: payments.panel.population }
      : null
    : funding.individualAmount > 0
      ? {
          n: Math.round(funding.collected / funding.individualAmount),
          m: Math.max(1, Math.round(funding.requiredAmount / funding.individualAmount)),
        }
      : null;
  // One chip per person from the payment roster (everyone for organizers,
  // just you otherwise — other people's payment state is private).
  const COMMITTED = new Set(["authorized", "charging", "on_hold", "paid", "used"]);
  const chips = (payments?.roster ?? []).map((r) => ({
    userId: r.userId,
    name: r.displayName,
    initials: r.userId === currentUserId ? "You".slice(0, 1) : initialsOf(r.displayName),
    committed: COMMITTED.has(r.state),
    withdrew: r.state === "canceled" && r.detail === "canceled by participant",
    me: r.userId === currentUserId,
  }));

  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* §6: one combined list of every element this funding_request
          covers, when it's a real bundle — name, category, and price per
          member, above the shared funding status/action below (which
          already operates on funding.id regardless of member count). */}
      {members.length > 0 && (
        <div className="rounded-lg border border-brand-line p-3">
          <span className="text-xs font-medium text-black dark:text-zinc-50">
            This bundle ({members.length + 1} elements)
          </span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {members.map((m) => (
              <li key={m.elementId} className="flex items-center justify-between text-xs">
                <span>
                  <span className="text-brand-muted">{m.type}</span> — {m.title}
                </span>
                {m.price !== null && (
                  <span className="font-medium">{formatCurrency(m.price, m.currency ?? currency)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {funding.status === "collecting" ? (
        // Founder redesign (2026-10-14): one funding card — your share and
        // Commit first, then where the group stands (hatched bar, "N of M
        // committed", one chip per person), then the organizer's controls.
        <div className="flex flex-col gap-3">
          {payments?.withdrawals && !funding.chargeStatus && (
            <WithdrawalNotice
              tripId={tripId}
              elementId={elementId}
              fundingRequestId={funding.id}
              currency={currency}
              info={payments.withdrawals}
            />
          )}
          {payments ? (
            <MandatePanel
              tripId={tripId}
              elementId={elementId}
              fundingRequestId={funding.id}
              currency={currency}
              individualAmount={funding.individualAmount}
              platformFeePercent={funding.platformFeePercent}
              deadline={funding.deadline}
              chargeStatus={funding.chargeStatus}
              elementLabel={elementLabel}
              optionTitle={optionTitle}
              requiredAmount={funding.requiredAmount}
              {...payments.panel}
            />
          ) : (
            // Manual ledger (no Stripe here): same share + Commit, with a
            // light confirm step in the same Lightbox — no payment method.
            <div className="flex flex-col gap-2.5">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-[family-name:var(--font-display)] text-[30px] font-bold leading-none tracking-[-0.02em] text-foreground">
                  {formatCurrency(funding.individualAmount, currency)}
                </span>
                <span className="text-sm text-brand-muted">your share</span>
              </p>
              {justContributed ? (
                <button
                  type="button"
                  disabled
                  className={`${btnCommit} border-[1.5px] border-brand-accent !bg-brand-teal-wash !text-brand-accent disabled:opacity-100`}
                >
                  ✓ Committed {formatCurrency(manualTotal, currency)}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={contribPending}
                    onClick={() => {
                      setContribError(null);
                      // Traveler details first (overlay), then the confirm step.
                      travelerGate.gate(() => setConfirming(true));
                    }}
                    className={btnCommit}
                  >
                    Commit {formatCurrency(funding.individualAmount, currency)}
                  </button>
                  <p className="text-center text-[12.5px] text-brand-muted">
                    {manualFee > 0 ? `+ ${formatCurrency(manualFee, currency)} Catoco fee. ` : ""}Nothing charged until funded.
                  </p>
                </>
              )}
              {contribError && !confirming && <p className="text-xs text-brand-coral">{contribError}</p>}
              {confirming && (
                <Lightbox
                  title="Confirm your share"
                  subtitle={[elementLabel, optionTitle].filter(Boolean).join(" · ")}
                  onClose={() => {
                    if (!contribPending) setConfirming(false);
                  }}
                >
                  <div className="rounded-xl border border-brand-line bg-brand-surface px-3.5 py-2.5 text-sm">
                    <ShareBreakdown share={funding.individualAmount} percent={funding.platformFeePercent} currency={currency} showPercent={false} />
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-xl border-[1.5px] border-brand-teal-deep bg-brand-teal-wash px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground">
                    <b className="font-semibold text-brand-accent">You are committing your share. Nothing is charged today.</b>
                    <span>
                      {formatCurrency(manualTotal, currency)} is due when the group reaches its funding goal of{" "}
                      {formatCurrency(funding.requiredAmount, currency)}. If the goal is not met by{" "}
                      {funding.deadline
                        ? new Date(funding.deadline).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
                        : "the funding deadline"}
                      , your commitment is released.
                    </span>
                  </div>
                  {contribError && (
                    <p role="alert" className="text-xs text-brand-coral">
                      {contribError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={contribPending}
                    onClick={() => {
                      setContribError(null);
                      startContrib(async () => {
                        const res = await addFundingContribution(tripId, elementId, funding.id, funding.individualAmount);
                        if (res.error) {
                          if (res.error.toLowerCase().includes("already contributed")) {
                            setJustContributed(true);
                            setConfirming(false);
                          } else {
                            setContribError(res.error);
                          }
                          return;
                        }
                        setJustContributed(true);
                        setConfirming(false);
                        router.refresh();
                      });
                    }}
                    className={`mt-1 h-12 w-full text-[15px] font-semibold ${btnPrimary} outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-deep focus-visible:ring-offset-2`}
                  >
                    {contribPending ? "Committing…" : `Commit ${formatCurrency(manualTotal, currency)}`}
                  </button>
                  <button
                    type="button"
                    disabled={contribPending}
                    onClick={() => setConfirming(false)}
                    className="mx-auto rounded-md px-2 py-1.5 text-sm font-semibold text-brand-muted underline underline-offset-[3px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-teal-deep disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </Lightbox>
              )}
            </div>
          )}

          {/* Where the group stands. */}
          <div className="flex flex-col gap-2">
            <div
              className="h-3 overflow-hidden rounded-full"
              style={{
                background: "repeating-linear-gradient(135deg, var(--brand-teal-wash) 0 6px, var(--brand-line) 6px 12px)",
                boxShadow: "inset 0 0 0 1.5px var(--brand-teal-deep)",
              }}
              role="img"
              aria-label={`${formatCurrency(funding.collected, currency)} of ${formatCurrency(funding.requiredAmount, currency)} collected`}
            >
              <div className="h-full bg-brand-teal-deep" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px] text-brand-muted">
              {committedOf && (
                <span>
                  <b className="font-semibold text-foreground">
                    {committedOf.n} of {committedOf.m}
                  </b>{" "}
                  committed
                </span>
              )}
              <span className="tabular-nums">
                {formatCurrency(funding.collected, currency)} of {formatCurrency(funding.requiredAmount, currency)}
              </span>
            </div>
            {chips.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Who's committed">
                {chips.map((c) => (
                  <li
                    key={c.userId}
                    className={`flex items-center gap-2 rounded-full border py-[3px] pl-1 pr-3 text-[13px] ${
                      c.committed ? "border-brand-line text-foreground" : "border-dashed border-brand-line text-brand-muted"
                    } ${c.me ? "!border-brand-accent" : ""}`}
                  >
                    <span
                      aria-hidden
                      className={`grid size-6 place-items-center rounded-full font-[family-name:var(--font-display)] text-[10px] font-bold ${
                        c.committed ? "bg-brand-teal-wash text-brand-accent" : "bg-brand-line/60 text-brand-muted"
                      }`}
                    >
                      {c.initials}
                    </span>
                    {c.name}
                    {c.withdrew && " · withdrew"}
                    <span className="sr-only">{c.committed ? " — committed" : c.withdrew ? "" : " — not yet"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Charging / failed phases keep the detailed per-person list
              (failure reasons etc. — the retry/failed redesign is a later pass). */}
          {payments && funding.chargeStatus && (
            <PaymentRoster entries={payments.roster} isOrganizerView={payments.isOrganizerView} />
          )}
          {canManage && (
            <div className="flex items-end gap-2 border-t border-brand-line pt-3">{purchaserSelect}</div>
          )}
          {reassignError && <p className="text-xs text-brand-coral">{reassignError}</p>}
          {priceInfo && (
            <PriceCheck
              tripId={tripId}
              elementId={elementId}
              currency={currency}
              share={funding.individualAmount}
              canAct={canAct}
              editable={!funding.chargeStatus}
              info={priceInfo}
            />
          )}
          {refundControls}
        </div>
      ) : (
        <div className="rounded-lg border border-brand-line p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-black dark:text-zinc-50">
              {funding.status === "booked" ? "Booked" : canAct ? "Funded" : "✓ The group has funded this"}
            </span>
          </div>
          {funding.status === "ready_to_purchase" && !canAct && (
            <p className="mt-1 text-xs text-brand-muted">
              {funding.purchaserName === "You" ? "You're" : `${funding.purchaserName} is`} booking it now. You will see the booking
              details here once it is done.
            </p>
          )}
          <div className="mt-2 text-xs text-brand-muted">
            {formatCurrency(funding.collected, currency)} / {formatCurrency(funding.requiredAmount, currency)} collected
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-brand-line">
            <div className="h-full bg-brand-teal" style={{ width: `${pct}%` }} />
          </div>
          {canManage && <div className="mt-3 flex items-end gap-2 border-t border-brand-line pt-3">{purchaserSelect}</div>}
          {reassignError && <p className="text-xs text-red-500">{reassignError}</p>}
          {payments && <PaymentRoster entries={payments.roster} isOrganizerView={payments.isOrganizerView} />}
          {refundControls}
        </div>
      )}

      {funding.status === "collecting" && (
        <>
          {/* The one funding deadline: everyone sees the saved date here,
              organizers change it here (also opened from the header's "⋯"
              → "Set a new deadline"). */}
          {(canManage || funding.deadline) && (
            <div id="funding-deadline" className="scroll-mt-24 rounded-lg border border-brand-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs">
                  <span className="text-brand-muted">Funding deadline: </span>
                  <span className="font-medium">{savedDeadline ? formatDate(savedDeadline) : "Not set yet"}</span>
                </span>
                {canManage && !editingDeadline && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeadline(savedDeadline);
                      setEditingDeadline(true);
                    }}
                    className={`h-8 px-3 text-xs ${btnSecondary}`}
                  >
                    {savedDeadline ? "Change" : "Set"}
                  </button>
                )}
              </div>
              {canManage && editingDeadline && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>New deadline</span>
                    <input
                      type="date"
                      className={`${field} w-40`}
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={deadlinePending || !deadline}
                    onClick={() => {
                      setDeadlineError(null);
                      startDeadline(async () => {
                        const res = await setFundingDeadline(
                          tripId,
                          elementId,
                          funding.id,
                          new Date(deadline).toISOString(),
                        );
                        if (res.error) {
                          setDeadlineError(res.error);
                          return;
                        }
                        setEditingDeadline(false);
                        router.refresh();
                      });
                    }}
                    className={`h-9 px-3 text-xs ${btnPrimary}`}
                  >
                    {deadlinePending ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={deadlinePending}
                    onClick={() => {
                      setEditingDeadline(false);
                      setDeadlineError(null);
                    }}
                    className={`h-9 px-3 text-xs ${btnSecondary}`}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {deadlineError && <p className="mt-1 text-xs text-red-500">{deadlineError}</p>}

              {canManage && funding.deadline && deadlinePassed && payments && funding.chargeStatus === null && (
                <p className="mt-3 text-xs text-brand-muted">
                  Deadline passed — charges run on the next scheduled pass. If not everyone
                  authorized in time, you&apos;ll be able to resolve it here after that.
                </p>
              )}

              {canManage && funding.deadline && deadlinePassed && (!payments || funding.chargeStatus === "failed") && (
                <div className="mt-3">
                  <p className="text-xs text-brand-muted">
                    {isFullyFunded
                      ? "Deadline passed — you've hit the funding goal. Resolve to mark it ready to purchase."
                      : "Deadline passed — resolve the outcome. If unfunded, is the locked choice still available at this price?"}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={resolvePending}
                      onClick={() => {
                        setResolveError(null);
                        startResolve(async () => {
                          const res = await resolveFundingOutcome(tripId, elementId, funding.id, true);
                          if (res.error) {
                            setResolveError(res.error);
                            return;
                          }
                          router.refresh();
                        });
                      }}
                      className={`px-3 py-1.5 text-xs ${btnSecondary}`}
                    >
                      {isFullyFunded ? "Resolve" : "Resolve — still viable"}
                    </button>
                    {!isFullyFunded && (
                      <button
                        type="button"
                        disabled={resolvePending}
                        onClick={() => {
                          setResolveError(null);
                          startResolve(async () => {
                            const res = await resolveFundingOutcome(
                              tripId,
                              elementId,
                              funding.id,
                              false,
                            );
                            if (res.error) {
                              setResolveError(res.error);
                              return;
                            }
                            router.refresh();
                          });
                        }}
                        className={`px-3 py-1.5 text-xs ${btnSecondary}`}
                      >
                        Resolve — no longer viable
                      </button>
                    )}
                  </div>
                  {resolveError && <p className="mt-1 text-xs text-red-500">{resolveError}</p>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {funding.status === "ready_to_purchase" && canAct && booking && !booking.alreadyBooked && !funding.refundedAt && !payments?.refundRequestedAt && (
        <ReadyToBook
          tripId={tripId}
          elementId={elementId}
          optionValue={booking.optionValue}
          draft={booking.draft}
          roster={booking.roster}
          showIncidentals={booking.showIncidentals}
          amountFromCard={booking.amountFromCard}
          travelers={booking.travelers}
        />
      )}

      {funding.status === "booked" && (
        <p className="rounded-lg border border-brand-line p-3 text-xs text-brand-muted">
          Actual: {formatCurrency(funding.actualAmountPaid ?? funding.requiredAmount, currency)}
        </p>
      )}
    </div>
  );
}
