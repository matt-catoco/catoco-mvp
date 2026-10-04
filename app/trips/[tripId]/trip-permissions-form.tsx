"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTripPermissions } from "./actions";
import { btnPrimary, fieldClass, labelClass } from "@/lib/ui";

export type TripPermissions = {
  allowParticipantElements: boolean;
  allowParticipantSubgroups: boolean;
  submissionDeadlineDays: number;
  fundingDeadlineDays: number;
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
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm text-black dark:text-zinc-50">{title}</span>
        <span className="block text-xs text-brand-muted">{detail}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className="flex shrink-0 items-center gap-2"
      >
        <span className={`w-6 text-right text-xs font-medium ${checked ? "text-teal-700 dark:text-teal-400" : "text-brand-muted"}`}>
          {checked ? "On" : "Off"}
        </span>
        <span
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            checked ? "bg-teal-700" : "bg-black/[.15] dark:bg-white/[.2]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
    </div>
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
          detail={
            v.allowParticipantElements
              ? "Anyone on the trip can add things to it."
              : "Only you and co-organizers can add things to the trip."
          }
        />
        <div className={v.allowParticipantElements ? "" : "pointer-events-none opacity-40"}>
          <Toggle
            checked={v.allowParticipantSubgroups}
            onChange={(x) => setV({ ...v, allowParticipantSubgroups: x })}
            title="Participants can plan for a subgroup"
            detail={
              v.allowParticipantSubgroups
                ? "Participants can pick who an element is for and lock in their own subgroup elements. Elements for Everyone stay organizer-locked."
                : "Participants' elements are always for Everyone, and only organizers lock them in."
            }
          />
        </div>

        <div className="border-t border-black/[.08] pt-4 dark:border-white/[.1]">
          <span className="text-xs font-medium text-black dark:text-zinc-50">Default timing</span>
          <p className="text-xs text-brand-muted">
            Applies to elements and funding started after you change it — existing deadlines stay as they are.
          </p>
          <div className="mt-2 flex gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={labelClass}>Submission deadline</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  className={`h-9 w-20 ${fieldClass}`}
                  value={v.submissionDeadlineDays}
                  onChange={(e) => setV({ ...v, submissionDeadlineDays: Number(e.target.value) })}
                />
                <span className="text-xs text-brand-muted">days after added</span>
              </span>
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={labelClass}>Funding deadline</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  className={`h-9 w-20 ${fieldClass}`}
                  value={v.fundingDeadlineDays}
                  onChange={(e) => setV({ ...v, fundingDeadlineDays: Number(e.target.value) })}
                />
                <span className="text-xs text-brand-muted">days after lock-in</span>
              </span>
            </label>
          </div>
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
