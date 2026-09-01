"use client";

import { useState, useTransition } from "react";
import { setParticipantCapacity } from "./actions";

const field =
  "h-9 w-24 rounded-lg border border-black/[.12] bg-transparent px-2 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";

/**
 * Min/max group size — informational only, doesn't block joining. First-come-
 * first-served up to max is left to the roster's own join order (joined_at),
 * shown alongside this on the page; there's no enforcement mechanic here.
 */
export function CapacityForm({
  tripId,
  initialMin,
  initialMax,
}: {
  tripId: string;
  initialMin: number | null;
  initialMax: number | null;
}) {
  const [min, setMin] = useState(initialMin != null ? String(initialMin) : "");
  const [max, setMax] = useState(initialMax != null ? String(initialMax) : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setParticipantCapacity(
        tripId,
        min.trim() ? Number(min) : null,
        max.trim() ? Number(max) : null,
      );
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Minimum</span>
          <input
            type="number"
            min={1}
            step={1}
            className={field}
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Maximum</span>
          <input
            type="number"
            min={1}
            step={1}
            className={field}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-9 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {saved && !error && <p className="text-xs text-zinc-500">Saved.</p>}
    </div>
  );
}
