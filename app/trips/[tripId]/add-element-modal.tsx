"use client";

import { useEffect, useState } from "react";
import { AddElementForm } from "./add-element-form";
import type { TripContext } from "@/lib/trip-elements";

type RosterEntry = { userId: string; displayName: string; isOrganizer: boolean };

/**
 * The "+ Add element" trigger and its lightbox — a plain client-state modal,
 * not an intercepting route: simpler to build, and a direct/refreshed visit
 * to /trips/[tripId]/add-element still works fine as its own full page
 * regardless, since that route is untouched. Trades away a shareable modal
 * URL, which isn't a requirement here.
 */
export function AddElementModal({
  tripId,
  currentUserId,
  isOrganizer,
  roster,
  tripContext,
}: {
  tripId: string;
  currentUserId: string;
  isOrganizer: boolean;
  roster: RosterEntry[];
  tripContext?: TripContext;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        + Add element
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          {/* mx-auto + a fixed top/bottom margin instead of flex items-center:
              centering a taller-than-viewport child with flex+overflow-y-auto
              clips the top of the content off-screen, unreachable by
              scrolling, in a way that reads as fields silently missing
              rather than a layout bug — this form's pill rows made it
              tall enough to actually hit that. */}
          <div
            className="mx-auto my-8 w-full max-w-xl rounded-2xl border border-brand-line bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
                Add an element
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1 text-brand-muted transition-colors hover:bg-brand-teal-wash hover:text-brand-teal-deep"
              >
                ✕
              </button>
            </div>
            <AddElementForm
              tripId={tripId}
              currentUserId={currentUserId}
              isOrganizer={isOrganizer}
              roster={roster}
              tripContext={tripContext}
            />
          </div>
        </div>
      )}
    </>
  );
}
