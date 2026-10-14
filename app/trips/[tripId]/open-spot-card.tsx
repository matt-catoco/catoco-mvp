"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { takeWithdrawnSpot } from "./payment-actions";
import { btnCommit } from "@/lib/ui";
import { formatCurrency } from "@/lib/trip-elements";

/**
 * For a trip member who isn't on this (locked) element: someone withdrew, so
 * there's a spot to take at the same share (founder, 2026-10-14). Taking it
 * fills the gap — the share doesn't change and Commit un-pauses for
 * everyone; the newcomer then commits like anyone else.
 */
export function OpenSpotCard({
  tripId,
  elementId,
  fundingRequestId,
  share,
  currency,
  openSpots,
}: {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  share: number;
  currency: string;
  openSpots: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-brand-teal-deep bg-brand-teal-wash px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground">
      <b className="font-semibold text-brand-accent">{openSpots === 1 ? "A spot opened up" : `${openSpots} spots opened up`}</b>
      <span>
        Someone withdrew. Take the spot to join at {formatCurrency(share, currency)} per person — you&apos;ll commit next, and
        nothing is charged until everyone is committed.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await takeWithdrawnSpot(tripId, elementId, fundingRequestId);
            if (res.error) return setError(res.error);
            router.refresh();
          });
        }}
        className={`${btnCommit} !h-11 !text-[15px]`}
      >
        {pending ? "Taking the spot…" : "Take the spot"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-brand-coral">
          {error}
        </p>
      )}
    </div>
  );
}
