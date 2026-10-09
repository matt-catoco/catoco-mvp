"use client";

import { useState, useTransition } from "react";
import { IconPicker } from "./icon-picker";
import { createTrip } from "./actions";
import type { IconAttribution } from "@/lib/trip-icons";
import {
  DEFAULT_TRIP_PERMISSIONS,
  TripPermissionsFields,
  tripPermissionsError,
} from "@/components/trip-permissions-fields";

/**
 * Trip creation: a name, optional icon, and the trip's settings
 * (permissions + default timing — prefilled with the defaults, changeable
 * later in Trip settings). The multi-step element wizard was retired in the
 * 2026-09-01 redesign; elements (Dates, Destination, Travel, ...) are added
 * from Trip Home once the trip exists.
 */
export function NewTripForm({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [iconAttribution, setIconAttribution] = useState<IconAttribution | null>(null);
  const [permissions, setPermissions] = useState(DEFAULT_TRIP_PERMISSIONS);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOk = name.trim().length > 0;

  function submit() {
    if (!nameOk) return;
    const invalid = tripPermissionsError(permissions);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const res = await createTrip(name, icon, iconAttribution, permissions);
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
        <IconPicker
          value={icon}
          attribution={iconAttribution}
          userId={userId}
          onChange={(next, nextAttribution) => {
            setIcon(next);
            setIconAttribution(nextAttribution);
          }}
        />
      </div>

      <details className="group rounded-xl border border-black/[.1] dark:border-white/[.14]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-black dark:text-zinc-50">
          Advanced settings
          <span className="text-xs font-normal text-brand-muted group-open:hidden">Defaults are fine for most trips</span>
        </summary>
        <div className="border-t border-black/[.08] p-4 dark:border-white/[.1]">
          <TripPermissionsFields value={permissions} onChange={setPermissions} />
          <p className="mt-4 text-xs text-brand-muted">You can change these any time from the trip&apos;s settings (gear icon).</p>
        </div>
      </details>

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
