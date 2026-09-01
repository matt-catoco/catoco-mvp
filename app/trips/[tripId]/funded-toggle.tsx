"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markElementFunded } from "./actions";

/**
 * Marks a confirmed element as funded (or reverts it) — the milestone
 * beyond Confirmed from the homepage's 3-state key. No real payment
 * mechanism behind this yet; this is a manual flag. Only rendered when the
 * caller already determined the viewer qualifies (creator, organizer, or
 * co-organizer) — mark_element_funded() enforces it server-side regardless.
 */
export function FundedToggle({
  tripId,
  elementId,
  funded,
}: {
  tripId: string;
  elementId: string;
  funded: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await markElementFunded(tripId, elementId, !funded);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className="text-xs font-medium text-zinc-500 underline hover:text-black disabled:opacity-50 dark:hover:text-zinc-50"
    >
      {pending ? "Saving…" : funded ? "Mark not funded" : "Mark funded"}
    </button>
  );
}
