"use client";

import { useState, useTransition } from "react";
import { sendTripInvite } from "./actions";

export type TripInvite = { email: string; lastSentAt: string; sendCount: number };

const field =
  "h-9 w-full rounded-lg border border-black/[.12] bg-transparent px-2 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";

const formatSentAt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/**
 * Organizer/co-organizer-only (gated at the call site in participants/page.tsx,
 * not here) — sending an invite auto-grants beta access via send_trip_invite(),
 * so this stays narrower than InviteLink's own visibility on purpose.
 */
export function InviteByEmail({ tripId, initialInvites }: { tripId: string; initialInvites: TripInvite[] }) {
  const [email, setEmail] = useState("");
  const [invites, setInvites] = useState(initialInvites);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upsertInvite(target: string, sendCount: number) {
    const now = new Date().toISOString();
    setInvites((prev) => [{ email: target, lastSentAt: now, sendCount }, ...prev.filter((i) => i.email !== target)]);
  }

  function send(target: string) {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const res = await sendTripInvite(tripId, target);
      if (res.error) {
        setError(res.error);
        return;
      }
      setStatus(res.alreadyInvited ? `Resent to ${target}.` : `Invited ${target}.`);
      upsertInvite(target, res.sendCount ?? (invites.find((i) => i.email === target)?.sendCount ?? 0) + 1);
      if (target === email.trim().toLowerCase()) setEmail("");
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) send(email.trim().toLowerCase());
        }}
      >
        <input
          type="email"
          placeholder="name@email.com"
          aria-label="Email to invite"
          className={field}
          value={email}
          disabled={pending}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="h-9 shrink-0 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </form>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {status && !error && <p className="text-xs text-zinc-500">{status}</p>}

      {invites.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {invites.map((inv) => (
            <li
              key={inv.email}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-black/[.1] px-3 py-2 text-sm dark:border-white/[.14]"
            >
              <span className="min-w-0 break-all text-black dark:text-zinc-50">{inv.email}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-zinc-500">sent {formatSentAt(inv.lastSentAt)}</span>
                <button
                  type="button"
                  onClick={() => send(inv.email)}
                  disabled={pending}
                  className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 disabled:opacity-50 dark:border-white/[.16]"
                >
                  Resend
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
