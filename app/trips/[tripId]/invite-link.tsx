"use client";

import { useState } from "react";
import { markInvitesSent } from "./actions";

/**
 * Reuses the flow-1 invite-link pattern (/trip/[tripId]/join) as a plain
 * copy/paste link — no per-person tracking. First copy flips
 * trip_elements.invites_sent, which feeds the Participants status lifecycle.
 */
export function InviteLink({
  tripId,
  initialInvitesSent,
}: {
  tripId: string;
  initialInvitesSent: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(initialInvitesSent);
  const path = `/trip/${tripId}/join`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context) — the link is
      // still shown below to copy by hand.
    }
    if (!sent) {
      setSent(true);
      markInvitesSent(tripId);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        {copied ? "Copied!" : "Copy invite link"}
      </button>
      <p className="break-all text-xs text-zinc-500">{path}</p>
    </div>
  );
}
