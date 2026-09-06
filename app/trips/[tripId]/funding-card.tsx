"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addFundingContribution,
  reassignPurchaser,
  reportElementBooked,
  resolveFundingOutcome,
  setFundingDeadline,
} from "./actions";
import { btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";
import { formatCurrency } from "@/lib/trip-elements";

const field = `h-9 ${fieldClass}`;

export type FundingRequestInfo = {
  id: string;
  requiredAmount: number;
  collected: number;
  status: "collecting" | "ready_to_purchase" | "booked";
  deadline: string | null;
  purchaserId: string | null;
  purchaserName: string;
  actualAmountPaid: number | null;
};

export type FundingRosterEntry = { userId: string; displayName: string };

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
  scopedParticipantCount,
}: {
  tripId: string;
  elementId: string;
  currentUserId: string;
  canManage: boolean;
  funding: FundingRequestInfo;
  roster: FundingRosterEntry[];
  currency?: string;
  /** element_participants count (opted_in) for this element — §14's "your
   * fair share" minimum is required_amount / this. Falls back to no
   * enforced minimum (any amount > 0) if not provided or zero. */
  scopedParticipantCount?: number;
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

  const [contribution, setContribution] = useState("");
  const [contribError, setContribError] = useState<string | null>(null);
  const [contribPending, startContrib] = useTransition();

  const [deadline, setDeadline] = useState(funding.deadline?.slice(0, 10) ?? "");
  // funding is a fresh prop after every router.refresh() (e.g. post-resolve,
  // which clears funding_deadline server-side), but useState's initializer
  // only runs on first mount — without this, the date input silently kept
  // showing the pre-resolve deadline even though the real value had already
  // cleared (the resolve buttons disappearing correctly proved the data was
  // right; this input just never re-synced to it).
  useEffect(() => {
    setDeadline(funding.deadline?.slice(0, 10) ?? "");
  }, [funding.deadline]);
  const [deadlinePending, startDeadline] = useTransition();
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

  const [resolvePending, startResolve] = useTransition();
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [actualPaid, setActualPaid] = useState("");
  const [reportPending, startReport] = useTransition();
  const [reportError, setReportError] = useState<string | null>(null);

  const deadlinePassed = funding.deadline ? new Date(funding.deadline) <= new Date() : false;
  const isFullyFunded = funding.collected >= funding.requiredAmount;
  const pct = funding.requiredAmount > 0
    ? Math.min(100, Math.round((funding.collected / funding.requiredAmount) * 100))
    : 0;
  const fairShare =
    scopedParticipantCount && scopedParticipantCount > 0
      ? funding.requiredAmount / scopedParticipantCount
      : 0;

  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* Funding status — passive: progress, amounts, purchaser info. §14
          splits this from the active "Fund it" box below, which used to be
          one blended card. */}
      <div className="rounded-lg border border-brand-line p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-black dark:text-zinc-50">
            {funding.status === "booked" ? "Booked" : "Funding status"}
          </span>
        </div>

        <div className="mt-2 text-xs text-brand-muted">
          {formatCurrency(funding.collected, currency)} / {formatCurrency(funding.requiredAmount, currency)} collected
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-brand-line">
          <div className="h-full bg-brand-teal" style={{ width: `${pct}%` }} />
        </div>

        {/* §12: purchaser info + reassignment moved here, organizer/
            co-organizer-only — isPurchaser functional access below is a
            separate check, unaffected by this visibility change. */}
        {canManage && (
          <div className="mt-3 flex items-end gap-2 border-t border-brand-line pt-3">
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
            {reassignError && <p className="text-xs text-red-500">{reassignError}</p>}
          </div>
        )}
      </div>

      {funding.status === "collecting" && (
        <>
          {/* Fund it — active: the actual contribution action. */}
          <div className="rounded-lg border border-brand-line p-3">
            <span className="text-xs font-medium text-black dark:text-zinc-50">Fund it</span>
            <div className="mt-2 flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Contribute{fairShare > 0 ? ` — minimum ${formatCurrency(fairShare, currency)} (your share)` : ""}
                </span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className={`${field} w-28`}
                  value={contribution}
                  onChange={(e) => setContribution(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={contribPending}
                onClick={() => {
                  setContribError(null);
                  const amount = Number(contribution);
                  if (!Number.isFinite(amount) || amount <= 0) {
                    setContribError("Enter an amount above 0");
                    return;
                  }
                  if (fairShare > 0 && amount < fairShare) {
                    setContribError(
                      `Minimum contribution is ${formatCurrency(fairShare, currency)} (your fair share)`,
                    );
                    return;
                  }
                  startContrib(async () => {
                    const res = await addFundingContribution(tripId, elementId, funding.id, amount);
                    if (res.error) {
                      setContribError(res.error);
                      return;
                    }
                    setContribution("");
                    router.refresh();
                  });
                }}
                className={`h-9 px-3 text-xs ${btnPrimary}`}
              >
                {contribPending ? "Committing…" : "Commit"}
              </button>
            </div>
            {contribError && <p className="mt-1 text-xs text-red-500">{contribError}</p>}
          </div>

          {canManage && (
            <div className="rounded-lg border border-brand-line p-3">
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Funding deadline</span>
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
                      router.refresh();
                    });
                  }}
                  className={`h-9 px-3 text-xs ${btnSecondary}`}
                >
                  {deadlinePending ? "Saving…" : "Set"}
                </button>
              </div>
              {deadlineError && <p className="mt-1 text-xs text-red-500">{deadlineError}</p>}

              {funding.deadline && deadlinePassed && (
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

      {funding.status === "ready_to_purchase" && canAct && (
        <div className="rounded-lg border border-brand-line p-3">
          <p className="text-xs text-brand-muted">Funded — go ahead and purchase it.</p>
          <div className="mt-1.5 flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Actual amount paid *</span>
              <input
                type="number"
                min={0}
                step="any"
                className={`${field} w-32`}
                placeholder={funding.requiredAmount.toFixed(2)}
                value={actualPaid}
                onChange={(e) => setActualPaid(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={reportPending}
              onClick={() => {
                setReportError(null);
                const amount = Number(actualPaid);
                if (!actualPaid.trim() || !Number.isFinite(amount) || amount < 0) {
                  setReportError("Enter the actual amount paid before marking this booked");
                  return;
                }
                startReport(async () => {
                  const res = await reportElementBooked(tripId, elementId, "booked", amount);
                  if (res.error) {
                    setReportError(res.error);
                    return;
                  }
                  router.refresh();
                });
              }}
              className={`h-9 px-3 text-xs ${btnPrimary}`}
            >
              {reportPending ? "Saving…" : "Mark booked"}
            </button>
          </div>
          <button
            type="button"
            disabled={reportPending}
            onClick={() => {
              setReportError(null);
              startReport(async () => {
                const res = await reportElementBooked(tripId, elementId, "unavailable");
                if (res.error) {
                  setReportError(res.error);
                  return;
                }
                router.refresh();
              });
            }}
            className="mt-2 text-xs text-red-600 underline hover:text-red-700 disabled:opacity-40 dark:text-red-400"
          >
            Report unavailable
          </button>
          {reportError && <p className="mt-1 text-xs text-red-500">{reportError}</p>}
        </div>
      )}

      {funding.status === "booked" && (
        <p className="rounded-lg border border-brand-line p-3 text-xs text-brand-muted">
          Actual: {formatCurrency(funding.actualAmountPaid ?? funding.requiredAmount, currency)}
        </p>
      )}
    </div>
  );
}
