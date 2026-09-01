"use client";

import { useState, useTransition } from "react";
import { IconPicker } from "./icon-picker";
import { createTrip } from "./actions";

/**
 * Trip creation, reduced to just a name (+ optional icon) — the multi-step
 * element wizard was retired in the 2026-09-01 redesign. Everything else
 * (Dates, Destination, Travel, ...) is added from Trip Home once the trip
 * exists, by the organizer or by whoever they invite.
 */
export function NewTripForm({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOk = name.trim().length > 0;

  function submit() {
    if (!nameOk) return;
    setError(null);
    startTransition(async () => {
      const res = await createTrip(name, icon);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        New trip
      </h1>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Trip name
        </span>
        <input
          autoFocus
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sam's 30th in Portugal"
          className="h-11 rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && nameOk) submit();
          }}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Icon
        </span>
        <IconPicker value={icon} userId={userId} onChange={setIcon} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!nameOk || pending}
        className="self-start rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Creating…" : "Create trip"}
      </button>
    </div>
  );
}
