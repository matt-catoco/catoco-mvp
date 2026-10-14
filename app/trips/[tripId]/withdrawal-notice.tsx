"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recalculateFundingShares } from "./payment-actions";
import { btnCommit, btnSecondary } from "@/lib/ui";
import { formatCurrency } from "@/lib/trip-elements";

export type WithdrawalInfo = {
  /** who withdrew (organizer view only) */
  names: string[];
  /** people left once they're out */
  remaining: number;
  /** estimated new share for each of them */
  newShare: number;
  /** the share and headcount it was split over before the withdrawal */
  currentShare: number;
  population: number;
  /** when the shares are recalculated automatically if nobody acts */
  autoRecalcAt?: string | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "Someone";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Organizer notice after someone withdraws their commitment (founder spec,
 * 2026-10-14): Commit is paused for everyone else until the organizer
 * either re-splits the cost among the people still in, or invites someone
 * to take the spot.
 */
export function WithdrawalNotice({
  tripId,
  elementId,
  fundingRequestId,
  currency,
  info,
}: {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  currency: string;
  info: WithdrawalInfo;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div role="status" className="flex flex-col gap-2 rounded-xl border-[1.5px] border-amber-300 bg-amber-50 px-3.5 py-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <p className="font-semibold text-foreground">
        {joinNames(info.names)} withdrew
      </p>
      <p className="text-[13px] leading-relaxed text-brand-muted">
        The {formatCurrency(info.currentShare, currency)} share was split between {info.population} people, so this can&apos;t
        fund as it is. Recalculate for {info.remaining} {info.remaining === 1 ? "person" : "people"}, or invite someone to take
        the spot. Anyone whose authorization already covers the new amount stays committed. Everyone else is asked to
        re-authorize.
      </p>
      {info.autoRecalcAt && (
        <p className="text-[13px] font-medium text-foreground">
          If you don&apos;t act, the shares are recalculated automatically{" "}
          <span className="whitespace-nowrap">around {when(info.autoRecalcAt)}</span>.
        </p>
      )}
      {done ? (
        <p className="text-[13px] font-medium text-brand-accent">{done}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {info.remaining > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await recalculateFundingShares(tripId, elementId, fundingRequestId);
                  if (res.error) return setError(res.error);
                  setDone(
                    `Shares are now ${formatCurrency(res.share ?? info.newShare, currency)} each.` +
                      (res.reauthorize ? ` ${res.reauthorize} ${res.reauthorize === 1 ? "person needs" : "people need"} to commit again.` : ""),
                  );
                  router.refresh();
                });
              }}
              className={`${btnCommit} !h-auto min-h-10 !w-auto px-4 py-2 !text-[15px] leading-tight`}
            >
              {pending
                ? "Recalculating…"
                : `Recalculate for ${info.remaining} (${formatCurrency(info.newShare, currency)} each)`}
            </button>
          )}
          <Link
            href={`/trips/${tripId}/participants`}
            className={`inline-flex h-10 items-center bg-brand-surface px-4 text-sm font-semibold ${btnSecondary} outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-deep focus-visible:ring-offset-2`}
          >
            Invite someone
          </Link>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-brand-coral">
          {error}
        </p>
      )}
    </div>
  );
}
