"use client";

import { useEffect, useState } from "react";
import { AddElementForm, type BundleContext } from "./add-element-form";
import type { TripContext } from "@/lib/trip-elements";

type RosterEntry = { userId: string; displayName: string; isOrganizer: boolean };

/**
 * The "+ Add element" trigger and its lightbox — a plain client-state modal,
 * not an intercepting route: simpler to build, and a direct/refreshed visit
 * to /trips/[tripId]/add-element still works fine as its own full page
 * regardless, since that route is untouched. Trades away a shareable modal
 * URL, which isn't a requirement here.
 *
 * Owns the chaining state for a bundle-in-progress (§1 of the chain-at-
 * creation prompt): "Add element & bundle another" keeps the overlay open
 * and hands back a BundleContext snapshot instead of closing; `chainKey`
 * forces AddElementForm to remount fresh for the next element in the chain
 * (a plain state reset inside the same instance would still be carrying
 * the just-submitted element's leftover local state). The plain "Add
 * element" button ends the chain (if any) and closes the overlay.
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
  const [bundleContext, setBundleContext] = useState<BundleContext | null>(null);
  const [chainKey, setChainKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setBundleContext(null);
    setChainKey(0);
  }

  function handleChainedSubmit(next: BundleContext) {
    setBundleContext(next);
    setChainKey((k) => k + 1);
  }

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
          onClick={close}
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
                {bundleContext ? "Bundle another element" : "Add an element"}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-full p-1 text-brand-muted transition-colors hover:bg-brand-teal-wash hover:text-brand-teal-deep"
              >
                ✕
              </button>
            </div>
            <AddElementForm
              key={chainKey}
              tripId={tripId}
              currentUserId={currentUserId}
              isOrganizer={isOrganizer}
              roster={roster}
              tripContext={tripContext}
              bundleContext={bundleContext}
              onChainedSubmit={handleChainedSubmit}
              onFinalSubmit={close}
            />
          </div>
        </div>
      )}
    </>
  );
}
