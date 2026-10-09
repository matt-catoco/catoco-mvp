"use client";

import { useState, useTransition } from "react";
import { nudgeElement } from "./nudge-actions";
import { btnSecondary } from "@/lib/ui";

/** Organizer-only: remind everyone who hasn't acted in the current phase. */
export function NudgeButton({
  tripId,
  elementId,
  names,
  phaseLabel,
}: {
  tripId: string;
  elementId: string;
  names: string[];
  phaseLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (names.length === 0) return null;
  const who = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;

  return (
    <div className="flex w-full max-w-xl flex-wrap items-center justify-between gap-2 rounded-lg border border-black/[.08] px-4 py-3 text-left text-sm dark:border-white/[.145]">
      <span>
        <span className="font-semibold">
          {names.length} still to {phaseLabel}
        </span>
        <span className="text-brand-muted"> — {who}</span>
      </span>
      <span className="flex items-center gap-2">
        {message && <span className="text-xs text-brand-muted">{message}</span>}
        <button
          type="button"
          className={btnSecondary}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await nudgeElement(tripId, elementId);
              setMessage(res.error ?? (res.sent ? `Nudged ${res.sent}` : "Nobody to nudge"));
            })
          }
        >
          {pending ? "Sending…" : "Nudge"}
        </button>
      </span>
    </div>
  );
}
