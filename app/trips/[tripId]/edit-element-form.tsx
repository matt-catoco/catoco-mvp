"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { ElementMetadataFields } from "@/components/element-metadata-fields";
import type { ElementType } from "@/lib/trip-elements";
import { deleteElement, updateElement } from "./actions";
import { btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";

const field = `h-10 ${fieldClass}`;

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs font-medium text-brand-muted underline hover:text-black dark:hover:text-zinc-50"
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
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-brand-line p-3">
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
          className={`px-3 py-1.5 text-xs ${btnPrimary}`}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className={`px-3 py-1.5 text-xs ${btnSecondary}`}
        >
          Cancel
        </button>
      </div>

      <div className="mt-1 border-t border-brand-line pt-3">
        {confirmingDelete ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs">
            <p className="text-red-700 dark:text-red-400">
              Delete &ldquo;{label}&rdquo; entirely? This removes it and everything under it —
              submissions, votes, all of it. There&apos;s no undo.
            </p>
            {deleteError && <p className="mt-1.5 text-red-600 dark:text-red-400">{deleteError}</p>}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={deletePending}
                onClick={() => {
                  setDeleteError(null);
                  startDeleteTransition(async () => {
                    const res = await deleteElement(tripId, elementId);
                    if (res.error) {
                      setDeleteError(res.error);
                      return;
                    }
                    router.push(`/trips/${tripId}`);
                  });
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {deletePending ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                disabled={deletePending}
                onClick={() => {
                  setDeleteError(null);
                  setConfirmingDelete(false);
                }}
                className="text-brand-muted underline hover:text-black dark:hover:text-zinc-50 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-xs text-red-600 underline hover:text-red-700 dark:text-red-400"
          >
            Delete this element
          </button>
        )}
      </div>
    </div>
  );
}
