"use client";

import { useState, useTransition } from "react";
import { setParticipantRole } from "./actions";

/**
 * Role dropdown for one roster row — only rendered for rows the current
 * viewer (organizer or co-organizer) is allowed to manage. The organizer
 * row itself never gets one (ownership isn't reassigned here).
 */
export function ParticipantRoleSelect({
  tripId,
  userId,
  role,
}: {
  tripId: string;
  userId: string;
  role: "participant" | "co_organizer";
}) {
  const [value, setValue] = useState(role);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: "participant" | "co_organizer") {
    setError(null);
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await setParticipantRole(tripId, userId, next);
      if (res.error) {
        setValue(prev);
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value as "participant" | "co_organizer")}
        className="rounded-full border border-black/[.12] bg-transparent px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 outline-none disabled:opacity-50 dark:border-white/[.16]"
      >
        <option value="participant">Participant</option>
        <option value="co_organizer">Co-Organizer</option>
      </select>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}
