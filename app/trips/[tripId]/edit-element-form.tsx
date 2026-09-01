"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { ElementMetadataFields } from "@/components/element-metadata-fields";
import type { ElementType } from "@/lib/trip-elements";
import { updateElement } from "./actions";

const field =
  "h-10 w-full rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";
const labelClass = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

/**
 * Fix a mistake on an already-created element — collapsed behind an "Edit"
 * toggle (same pattern as SubmitOptionForm) so it doesn't clutter the
 * default read view. Authority is enforced server-side in update_element();
 * this only renders when the caller already determined the viewer qualifies
 * (creator, organizer, or co-organizer).
 */
export function EditElementForm({
  tripId,
  elementId,
  type,
  state,
  initialLabel,
  initialMetadata,
  initialOptionsDeadline,
  initialVotingDeadline,
  initialLockedValue,
}: {
  tripId: string;
  elementId: string;
  type: ElementType;
  state: "locked" | "open";
  initialLabel: string;
  initialMetadata: Record<string, string>;
  initialOptionsDeadline: string | null;
  initialVotingDeadline: string | null;
  initialLockedValue: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(initialLabel);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [optionsDeadline, setOptionsDeadline] = useState(
    initialOptionsDeadline?.slice(0, 10) ?? "",
  );
  const [votingDeadline, setVotingDeadline] = useState(
    initialVotingDeadline?.slice(0, 10) ?? "",
  );
  const [lockedValue, setLockedValue] = useState<Record<string, unknown>>(
    initialLockedValue ?? {},
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs font-medium text-zinc-500 underline hover:text-black dark:hover:text-zinc-50"
      >
        Edit
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateElement({
        tripId,
        elementId,
        type,
        label,
        metadata,
        state,
        optionsDeadline: optionsDeadline || null,
        votingDeadline: votingDeadline || null,
        lockedValue: state === "locked" ? lockedValue : undefined,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-black/[.08] p-3 dark:border-white/[.1]">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Label</span>
        <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      <ElementMetadataFields type={type} value={metadata} onChange={setMetadata} />

      {state === "locked" ? (
        <div>
          <span className={`${labelClass} mb-1 block`}>Value</span>
          <ElementValueFields type={type} value={lockedValue} onChange={setLockedValue} />
        </div>
      ) : (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Submission deadline</span>
            <input
              type="date"
              className={field}
              value={optionsDeadline}
              onChange={(e) => setOptionsDeadline(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Voting deadline</span>
            <input
              type="date"
              className={field}
              value={votingDeadline}
              onChange={(e) => setVotingDeadline(e.target.value)}
            />
          </label>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !label.trim()}
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="text-xs text-zinc-500 underline hover:text-red-500 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
