"use client";

import { fieldClass, labelClass } from "@/lib/ui";
import { NumberInput } from "@/components/number-input";
import { CUSHION_PERCENT_WARNING } from "@/lib/trip-permissions";
import type { TripPermissions } from "@/lib/trip-permissions";

export { DEFAULT_TRIP_PERMISSIONS, tripPermissionsError, type TripPermissions } from "@/lib/trip-permissions";

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
 * The trip's permission toggles + default timing, as plain controlled
 * fields. Shared by trip creation (saved with the new trip) and Trip
 * settings (saved via update_trip_permissions()). Every rule is enforced
 * server-side; this only edits values.
 */
export function TripPermissionsFields({
  value: v,
  onChange,
  timingNote,
}: {
  value: TripPermissions;
  onChange: (next: TripPermissions) => void;
  /** Optional line under "Default timing". */
  timingNote?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Toggle
        checked={v.allowParticipantElements}
        onChange={(x) => onChange({ ...v, allowParticipantElements: x, allowParticipantSubgroups: x && v.allowParticipantSubgroups })}
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
          onChange={(x) => onChange({ ...v, allowParticipantSubgroups: x })}
          title="Participants can plan for a subgroup"
          detail={
            v.allowParticipantSubgroups
              ? "Participants can pick who an element is for and lock in their own subgroup elements. Elements for Everyone stay organizer-locked."
              : "Participants' elements are always for Everyone, and only organizers lock them in."
          }
        />
      </div>

      <section className="flex flex-col gap-4 border-t border-black/[.08] pt-4 dark:border-white/[.1]">
        <span className="text-xs font-medium text-black dark:text-zinc-50">People</span>
        <Toggle
          checked={v.viewAllParticipants}
          onChange={(x) => onChange({ ...v, viewAllParticipants: x })}
          title="Participants can see everyone on the trip"
          detail={
            v.viewAllParticipants
              ? "Everyone sees who else is going."
              : "Participants see only their own name and yours — others appear without names. You and co-organizers always see everyone."
          }
        />
        <Toggle
          checked={v.allowParticipantInvites}
          onChange={(x) => onChange({ ...v, allowParticipantInvites: x })}
          title="Participants can invite others"
          detail={
            v.allowParticipantInvites
              ? "Everyone on the trip can share the invite link."
              : "Only you and co-organizers can share the invite link."
          }
        />
        <Toggle
          checked={v.allowOverMax}
          onChange={(x) => onChange({ ...v, allowOverMax: x })}
          title="Allow joining past the max"
          detail={
            v.allowOverMax
              ? "More people than the max can join. Anything with limited spots (e.g. a ski house for 8) goes to the first to commit; the rest are waitlisted."
              : "Once the trip reaches its max (you included), the invite link shows it's full."
          }
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-black/[.08] pt-4 dark:border-white/[.1]">
        <span className="text-xs font-medium text-black dark:text-zinc-50">Timing</span>
        {timingNote && <p className="text-xs text-brand-muted">{timingNote}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-3">
          <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
            <span className={labelClass}>Submission deadline</span>
            <span className="flex flex-wrap items-center gap-2">
              <NumberInput
                integer
                min={1}
                max={60}
                className={`h-9 w-20 ${fieldClass}`}
                value={v.submissionDeadlineDays}
                onValueChange={(n) => onChange({ ...v, submissionDeadlineDays: n })}
              />
              <span className="text-xs text-brand-muted">days after added</span>
            </span>
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
            <span className={labelClass}>Voting deadline</span>
            <span className="flex flex-wrap items-center gap-2">
              <NumberInput
                integer
                min={1}
                max={90}
                className={`h-9 w-20 ${fieldClass}`}
                value={v.votingDeadlineDays ?? 7}
                onValueChange={(n) => onChange({ ...v, votingDeadlineDays: n })}
              />
              <span className="text-xs text-brand-muted">days after submissions close</span>
            </span>
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
            <span className={labelClass}>Funding deadline</span>
            <span className="flex flex-wrap items-center gap-2">
              <NumberInput
                integer
                min={1}
                max={60}
                className={`h-9 w-20 ${fieldClass}`}
                value={v.fundingDeadlineDays}
                onValueChange={(n) => onChange({ ...v, fundingDeadlineDays: n })}
              />
              <span className="text-xs text-brand-muted">days after lock-in</span>
            </span>
          </label>
        </div>
        <p className="text-[11px] text-brand-muted">
          These pre-fill each new element&apos;s dates — you can still change them on the element.
        </p>

        <div className="flex flex-col gap-1">
          <span className={labelClass}>Deadline alert</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Deadline alert">
            {([12, 24, 48] as const).map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={v.deadlineAlertHours === h}
                onClick={() => onChange({ ...v, deadlineAlertHours: h })}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  v.deadlineAlertHours === h
                    ? "border-teal-700 bg-teal-700 text-white"
                    : "border-black/[.15] text-brand-muted dark:border-white/[.2]"
                }`}
              >
                {h} hours
              </button>
            ))}
          </div>
          <span className="text-xs text-brand-muted">
            Element cards show a clock when a submission, voting or funding deadline is this close.
          </span>
        </div>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Payment retry window</span>
          <span className="flex flex-wrap items-center gap-2">
            <NumberInput
              integer
              min={1}
              max={144}
              className={`h-9 w-20 ${fieldClass}`}
              value={v.retryHours}
              onValueChange={(n) => onChange({ ...v, retryHours: n })}
            />
            <span className="text-xs text-brand-muted">hours</span>
          </span>
          <span className="text-xs text-brand-muted">
            At the funding deadline everyone&apos;s card is put on hold. If someone&apos;s card fails, they get this long
            to fix it while the others wait — nobody is charged until every hold is in.
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3 border-t border-black/[.08] pt-4 dark:border-white/[.1]">
        <span className="text-xs font-medium text-black dark:text-zinc-50">Money</span>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Price cushion</span>
          {/* Same layout as the element-level CushionField: type, then amount, one row. */}
          <span className="flex items-center gap-2">
            <select
              className={`h-10 w-auto ${fieldClass}`}
              value={v.cushionKind}
              onChange={(e) => onChange({ ...v, cushionKind: e.target.value as "percent" | "amount" })}
              aria-label="Cushion type"
            >
              <option value="percent">% of each share</option>
              <option value="amount">per person</option>
            </select>
            <NumberInput
              min={0}
              step="any"
              className={`h-10 w-24 ${fieldClass}`}
              value={v.cushionValue}
              onValueChange={(n) => onChange({ ...v, cushionValue: Math.max(0, n) })}
              aria-label="Cushion amount"
            />
          </span>
          {v.cushionKind === "percent" && v.cushionValue >= CUSHION_PERCENT_WARNING && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              That&apos;s a {v.cushionValue}% cushion — people will authorize up to {Math.round(1 + v.cushionValue / 100)}× their
              share. Double-check it&apos;s not a typo.
            </span>
          )}
          <span className="text-xs text-brand-muted">
            Prices move between lock-in and booking. Everyone authorizes up to their share plus this, and is
            only charged the real price. Each element can override it.
          </span>
        </label>
      </section>
    </div>
  );
}
