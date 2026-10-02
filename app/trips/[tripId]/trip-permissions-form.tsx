"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTripPermissions } from "./actions";
import { btnPrimary, fieldClass, labelClass } from "@/lib/ui";

export type TripPermissions = {
  allowParticipantElements: boolean;
  allowParticipantSubgroups: boolean;
  fundingDeadlineDays: number;
  fundingGraceHours: number;
};

function Toggle({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm text-black dark:text-zinc-50">{title}</span>
        <span className="block text-xs text-brand-muted">{detail}</span>
      </span>
    </label>
  );
}

/**
 * Trip settings → Permissions & funding (organizer / co-organizer).
 * Every rule here is enforced server-side (create_element, lock_element,
 * create_funding_request_for_element) — this form only edits the trip's
 * settings via update_trip_permissions().
 */
export function TripPermissionsForm({ tripId, initial }: { tripId: string; initial: TripPermissions }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  return (
    <div className="rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]">
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Permissions &amp; funding</h2>

      <div className="mt-4 flex flex-col gap-4">
        <Toggle
          checked={v.allowParticipantElements}
          onChange={(x) => setV({ ...v, allowParticipantElements: x, allowParticipantSubgroups: x && v.allowParticipantSubgroups })}
          title="Participants can add elements"
          detail="Off: only you and co-organizers can add things to the trip."
        />
        <div className={v.allowParticipantElements ? "" : "pointer-events-none opacity-40"}>
          <Toggle
            checked={v.allowParticipantSubgroups}
            onChange={(x) => setV({ ...v, allowParticipantSubgroups: x })}
            title="Participants can plan for a subgroup"
            detail="Lets participants pick who an element is for and lock in their own subgroup elements. Elements for Everyone stay organizer-locked."
          />
        </div>

        <div className="border-t border-black/[.08] pt-4 dark:border-white/[.1]">
          <span className="text-xs font-medium text-black dark:text-zinc-50">Funding deadline</span>
          <p className="text-xs text-brand-muted">
            Applies to funding started after you change it — existing deadlines stay as they are.
          </p>
          <div className="mt-2 flex gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={labelClass}>Days after lock-in (1–60)</span>
              <input
                type="number"
                min={1}
                max={60}
                className={`h-9 ${fieldClass}`}
                value={v.fundingDeadlineDays}
                onChange={(e) => setV({ ...v, fundingDeadlineDays: Number(e.target.value) })}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={labelClass}>Reminder grace (hours, 0–72)</span>
              <input
                type="number"
                min={0}
                max={72}
                className={`h-9 ${fieldClass}`}
                value={v.fundingGraceHours}
                onChange={(e) => setV({ ...v, fundingGraceHours: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="mt-1 text-[11px] text-brand-muted">
            Grace = how long after funding opens before &quot;funding needed&quot; reminders start.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const res = await updateTripPermissions(tripId, v);
              if (res.error) {
                setMessage({ ok: false, text: res.error });
                return;
              }
              setMessage({ ok: true, text: "Saved" });
              router.refresh();
            });
          }}
          className={`h-9 px-4 text-sm ${btnPrimary}`}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {message && <span className={`text-xs ${message.ok ? "text-brand-muted" : "text-red-500"}`}>{message.text}</span>}
      </div>
    </div>
  );
}
