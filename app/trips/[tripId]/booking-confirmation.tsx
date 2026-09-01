"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reportElementBooked } from "./actions";

/**
 * Booking confirmation for a locked element with no funding_request at
 * all — Dates/Destination, or any unpriced locked value. Still goes
 * through the same booked/unavailable report per the ticket ("those go
 * straight to booking confirmation with no funding step"), just without a
 * funding card around it. Same report_element_booked() RPC, same
 * unavailable-cascade either way.
 */
export function BookingConfirmation({
  tripId,
  elementId,
}: {
  tripId: string;
  elementId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function report(outcome: "booked" | "unavailable") {
    setError(null);
    startTransition(async () => {
      const res = await reportElementBooked(tripId, elementId, outcome);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => report("booked")}
        className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Saving…" : "Mark booked"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => report("unavailable")}
        className="text-xs text-red-600 underline hover:text-red-700 disabled:opacity-40 dark:text-red-400"
      >
        Report unavailable
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
