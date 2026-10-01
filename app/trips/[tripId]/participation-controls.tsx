"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnSecondary } from "@/lib/ui";
import { leaveTrip, removeParticipant, setElementOptIn, setElementParticipant } from "./participation-actions";

/** Two-step inline confirm (no browser dialog), shared by the destructive controls. */
function useConfirmAction() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return { confirming, setConfirming, pending, startTransition, error, setError };
}

export function LeaveTripButton({ tripId }: { tripId: string }) {
  const router = useRouter();
  const a = useConfirmAction();
  return (
    <div className="mt-8 rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]">
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Leave this trip</h2>
      <p className="mt-1 text-xs text-zinc-500">
        You&apos;ll be taken off every element and your votes are removed. You can rejoin later with the
        invite link.
      </p>
      {!a.confirming ? (
        <button type="button" onClick={() => a.setConfirming(true)} className={`mt-3 h-8 px-3 text-xs ${btnSecondary}`}>
          Leave trip
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={a.pending}
            onClick={() => {
              a.setError(null);
              a.startTransition(async () => {
                const res = await leaveTrip(tripId);
                if (res.error) {
                  a.setError(res.error);
                  a.setConfirming(false);
                  return;
                }
                // Not back to the trip itself — opening it would rejoin you.
                router.push("/trips");
              });
            }}
            className="h-8 rounded-lg bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            {a.pending ? "Leaving…" : "Yes, leave"}
          </button>
          <button type="button" disabled={a.pending} onClick={() => a.setConfirming(false)} className={`h-8 px-3 text-xs ${btnSecondary}`}>
            Stay
          </button>
        </div>
      )}
      {a.error && <p className="mt-2 text-xs text-red-500">{a.error}</p>}
    </div>
  );
}

export function RemoveParticipantButton({ tripId, userId, name }: { tripId: string; userId: string; name: string }) {
  const router = useRouter();
  const a = useConfirmAction();
  return (
    <div className="flex flex-col items-end gap-0.5">
      {!a.confirming ? (
        <button
          type="button"
          onClick={() => a.setConfirming(true)}
          className="text-[10px] uppercase tracking-wide text-red-600 underline hover:text-red-700 dark:text-red-400"
        >
          Remove
        </button>
      ) : (
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={a.pending}
            onClick={() => {
              a.setError(null);
              a.startTransition(async () => {
                const res = await removeParticipant(tripId, userId);
                if (res.error) {
                  a.setError(res.error);
                  a.setConfirming(false);
                  return;
                }
                router.refresh();
              });
            }}
            className="text-[10px] font-medium uppercase tracking-wide text-red-600 underline disabled:opacity-40 dark:text-red-400"
          >
            {a.pending ? "Removing…" : `Remove ${name}?`}
          </button>
          <button type="button" disabled={a.pending} onClick={() => a.setConfirming(false)} className="text-[10px] uppercase tracking-wide text-zinc-500 underline">
            Cancel
          </button>
        </span>
      )}
      {a.error && <span className="max-w-64 text-right text-[10px] text-red-500">{a.error}</span>}
    </div>
  );
}

export type ScopeMember = { userId: string; displayName: string; optedIn: boolean | null };

/**
 * "Who's in" for an OPEN element: your own opt-out/back-in, and (organizer
 * / co-organizer) per-person toggles. optedIn null = not in scope at all
 * (only shown to organizers, who can add them). Bundled elements move as a
 * whole bundle — the RPC enforces that; the copy says so.
 */
export function ElementScopePanel({
  tripId,
  elementId,
  currentUserId,
  canManage,
  bundled,
  members,
}: {
  tripId: string;
  elementId: string;
  currentUserId: string;
  canManage: boolean;
  bundled: boolean;
  members: ScopeMember[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = members.find((m) => m.userId === currentUserId);
  const inCount = members.filter((m) => m.optedIn).length;

  function toggle(userId: string, next: boolean) {
    setError(null);
    setBusyId(userId);
    startTransition(async () => {
      const res =
        userId === currentUserId && !canManage
          ? await setElementOptIn(tripId, elementId, next)
          : await setElementParticipant(tripId, elementId, userId, next);
      setBusyId(null);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const visible = canManage ? members : members.filter((m) => m.userId === currentUserId);
  if (visible.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-brand-line p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-black dark:text-zinc-50">Who&apos;s in</span>
        <span className="text-[11px] text-brand-muted">{inCount} in</span>
      </div>
      {me && me.optedIn === false && (
        <p className="mt-1 text-xs text-brand-muted">
          You&apos;ve opted out — you won&apos;t vote on or pay for this unless you opt back in.
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-1.5">
        {visible.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 text-xs">
            <span className={m.optedIn ? "" : "text-brand-muted line-through"}>
              {m.userId === currentUserId ? "You" : m.displayName}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => toggle(m.userId, !m.optedIn)}
              className={`h-7 px-2.5 text-[11px] ${btnSecondary}`}
            >
              {busyId === m.userId
                ? "Saving…"
                : m.optedIn
                  ? m.userId === currentUserId
                    ? "Not me — opt out"
                    : "Take out"
                  : m.optedIn === false
                    ? m.userId === currentUserId
                      ? "Opt back in"
                      : "Put back in"
                    : "Add"}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-brand-muted">
        {bundled ? "Part of a bundle — this applies to every element in it. " : ""}
        Only while it&apos;s open; once it locks, the cost split is fixed.
      </p>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
