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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

/** Your own Opt out / Opt back in, on the element's status row (founder, 2026-10-19). */
export function OptOutButton({
  tripId,
  elementId,
  optedIn,
  full = false,
}: {
  tripId: string;
  elementId: string;
  optedIn: boolean;
  /** Waitlists are off and every spot is taken: you can't opt back in. */
  full?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-[11px] text-red-500">
          {error}
        </span>
      )}
      <button
        type="button"
        disabled={pending || (!optedIn && full)}
        title={!optedIn && full ? "Every spot is taken, and this trip doesn't use waitlists" : undefined}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await setElementOptIn(tripId, elementId, !optedIn);
            if (res.error) {
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        className="rounded-full border-[1.5px] border-brand-line px-2.5 py-0.5 text-xs font-semibold text-foreground transition-colors hover:border-brand-accent hover:text-brand-accent disabled:opacity-50 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        {pending ? "Saving…" : optedIn ? "Opt out" : full ? "Full" : "Opt back in"}
      </button>
    </span>
  );
}

export type ScopeMember = { userId: string; displayName: string; optedIn: boolean | null };

/**
 * "Who's invited" for an OPEN element (submission and voting; once it
 * funds, the card shows "Who's committed" instead): your own opt-out/back-in, and (organizer
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
  inCount: totalIn,
  guestListHidden = false,
  fullSpots = null,
}: {
  tripId: string;
  elementId: string;
  currentUserId: string;
  canManage: boolean;
  bundled: boolean;
  members: ScopeMember[];
  /** Everyone in, including people this viewer can't see. */
  inCount?: number;
  /** The trip hides participants from each other: this viewer only sees their own row. */
  guestListHidden?: boolean;
  /** Waitlists are off and all these spots are taken: nobody else can come in. */
  fullSpots?: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const me = members.find((m) => m.userId === currentUserId);
  const inCount = totalIn ?? members.filter((m) => m.optedIn).length;

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

  // The page already trims the list to what this viewer may see.
  const visible = members;
  if (visible.length === 0) return null;

  // Compact (founder, 2026-10-19): initials avatars like everywhere else,
  // full name on hover/focus. In first, then opted out; organizers also get
  // the trip members who aren't invited yet, dashed, to add them.
  const invited = visible.filter((m) => m.optedIn !== null).sort((a, b) => Number(b.optedIn) - Number(a.optedIn));
  const notInvited = canManage ? visible.filter((m) => m.optedIn === null) : [];
  const selected = visible.find((m) => m.userId === selectedId) ?? null;
  const nameOf = (m: ScopeMember) => (m.userId === currentUserId ? "You" : m.displayName);
  const actionLabel = (m: ScopeMember) =>
    m.optedIn
      ? m.userId === currentUserId
        ? "Opt out"
        : "Take out"
      : m.optedIn === false
        ? m.userId === currentUserId
          ? "Opt back in"
          : "Put back in"
        : "Add";

  const avatar = (m: ScopeMember) => {
    const status = m.optedIn ? "in" : m.optedIn === false ? "not participating" : "not invited";
    const label = `${m.userId === currentUserId ? `${m.displayName} (you)` : m.displayName} · ${status}`;
    const look = m.optedIn
      ? "bg-brand-teal-wash text-brand-accent"
      : m.optedIn === false
        ? "bg-brand-line/50 text-brand-muted line-through"
        : "border border-dashed border-brand-line text-brand-muted";
    const mine = m.userId === currentUserId ? "ring-2 ring-brand-accent" : "";
    const cls = `grid size-7 place-items-center rounded-full font-[family-name:var(--font-display)] text-[10px] font-bold ${look} ${mine} outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-1`;
    return canManage ? (
      <li key={m.userId}>
        <button
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={selectedId === m.userId}
          onClick={() => setSelectedId((id) => (id === m.userId ? null : m.userId))}
          className={`${cls} ${selectedId === m.userId ? "outline-2 outline-offset-2 outline-brand-accent" : ""}`}
        >
          {m.optedIn === null ? "+" : initialsOf(m.displayName)}
        </button>
      </li>
    ) : (
      <li key={m.userId} title={label} aria-label={label} tabIndex={0} role="img" className={cls}>
        {initialsOf(m.displayName)}
      </li>
    );
  };

  return (
    <div className="mt-3 rounded-lg border border-brand-line p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-black dark:text-zinc-50">Who&apos;s invited</span>
        <span className="text-[11px] text-brand-muted">{fullSpots !== null ? `Full · ${inCount} of ${fullSpots}` : `${inCount} in`}</span>
      </div>
      {guestListHidden && (
        <p className="mt-1 text-[11px] text-brand-muted">The guest list is hidden by the organizer.</p>
      )}
      {me && me.optedIn === false && (
        <p className="mt-1 text-xs text-brand-muted">
          You&apos;ve opted out — you won&apos;t vote on or pay for this unless you opt back in.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ul className="flex flex-wrap gap-1.5" aria-label="Invited">
          {invited.map(avatar)}
        </ul>
        {notInvited.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 border-l border-brand-line pl-3" aria-label="Not invited yet">
            {notInvited.map(avatar)}
          </ul>
        )}
      </div>
      {canManage && selected && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-black/[.03] px-2.5 py-1.5 text-xs dark:bg-white/[.05]">
          <span className="min-w-0 truncate">
            <b className="font-semibold">{nameOf(selected)}</b>
            <span className="text-brand-muted">
              {" "}
              · {selected.optedIn ? "in" : selected.optedIn === false ? "not participating" : "not invited"}
            </span>
          </span>
          <button
            type="button"
            disabled={pending || (!selected.optedIn && fullSpots !== null)}
            title={!selected.optedIn && fullSpots !== null ? "Every spot is taken — take someone out first" : undefined}
            onClick={() => toggle(selected.userId, !selected.optedIn)}
            className={`h-7 flex-none px-2.5 text-[11px] ${btnSecondary}`}
          >
            {busyId === selected.userId ? "Saving…" : actionLabel(selected)}
          </button>
        </div>
      )}
      {canManage && !selected && (
        <p className="mt-1.5 text-[11px] text-brand-muted">Tap someone to take them out or add them.</p>
      )}
      <p className="mt-2 text-[11px] text-brand-muted">
        {bundled ? "Part of a bundle — this applies to every element in it. " : ""}
        Only while it&apos;s open; once it locks, the cost split is fixed.
      </p>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
