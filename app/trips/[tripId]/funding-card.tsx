"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addFundingContribution,
  reportElementBooked,
  resolveFundingOutcome,
  setFundingDeadline,
} from "./actions";

const field =
  "h-9 w-full rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";
const labelClass = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

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
}: {
  tripId: string;
  elementId: string;
  currentUserId: string;
  canManage: boolean;
  funding: FundingRequestInfo;
}) {
  const router = useRouter();
  const isPurchaser = funding.purchaserId === currentUserId;
  const canAct = canManage || isPurchaser;

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

  return (
    <div className="mt-3 rounded-lg border border-black/[.08] p-3 dark:border-white/[.1]">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-black dark:text-zinc-50">
          {funding.status === "booked" ? "Booked" : "Funding"}
        </span>
        <span className="text-zinc-500">Purchaser: {funding.purchaserName}</span>
      </div>

      <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        {funding.collected.toFixed(2)} / {funding.requiredAmount.toFixed(2)} collected
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
        <div className="h-full bg-brand-teal" style={{ width: `${pct}%` }} />
      </div>

      {funding.status === "collecting" && (
        <>
          <div className="mt-3 flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Contribute</span>
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
              className="h-9 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {contribPending ? "Adding…" : "Add"}
            </button>
          </div>
          {contribError && <p className="mt-1 text-xs text-red-500">{contribError}</p>}

          {canManage && (
            <div className="mt-3 border-t border-black/[.08] pt-3 dark:border-white/[.1]">
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
                  className="h-9 rounded-lg border border-black/[.12] px-3 text-xs font-medium hover:bg-black/[.03] disabled:opacity-40 dark:border-white/[.16] dark:hover:bg-white/[.05]"
                >
                  {deadlinePending ? "Saving…" : "Set"}
                </button>
              </div>
              {deadlineError && <p className="mt-1 text-xs text-red-500">{deadlineError}</p>}

              {funding.deadline && deadlinePassed && (
                <div className="mt-3">
                  <p className="text-xs text-zinc-500">
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
                      className="rounded-lg border border-black/[.12] px-3 py-1.5 text-xs font-medium hover:bg-black/[.03] disabled:opacity-40 dark:border-white/[.16] dark:hover:bg-white/[.05]"
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
                        className="rounded-lg border border-black/[.12] px-3 py-1.5 text-xs font-medium hover:bg-black/[.03] disabled:opacity-40 dark:border-white/[.16] dark:hover:bg-white/[.05]"
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
        <div className="mt-3 border-t border-black/[.08] pt-3 dark:border-white/[.1]">
          <p className="text-xs text-zinc-500">Funded — go ahead and purchase it.</p>
          <div className="mt-1.5 flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Actual amount paid (optional)</span>
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
                startReport(async () => {
                  const res = await reportElementBooked(
                    tripId,
                    elementId,
                    "booked",
                    actualPaid.trim() ? Number(actualPaid) : undefined,
                  );
                  if (res.error) {
                    setReportError(res.error);
                    return;
                  }
                  router.refresh();
                });
              }}
              className="h-9 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
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
        <p className="mt-3 border-t border-black/[.08] pt-3 text-xs text-zinc-600 dark:border-white/[.1] dark:text-zinc-400">
          Actual: {(funding.actualAmountPaid ?? funding.requiredAmount).toFixed(2)}
        </p>
      )}
    </div>
  );
}
