"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { ElementMetadataFields } from "@/components/element-metadata-fields";
import {
  ELEMENT_LABELS,
  ELEMENT_TYPES,
  applyTripContext,
  emptyMetadataFor,
  emptyValueFor,
  validateOptionValue,
  type ElementType,
  type TripContext,
} from "@/lib/trip-elements";
import { createElement } from "./actions";
import { btnPrimary, fieldClass, labelClass, pillActiveTeal, pillInactive } from "@/lib/ui";

const field = `h-10 ${fieldClass}`;

type RosterEntry = { userId: string; displayName: string; isOrganizer: boolean };

/**
 * Any trip member can add an element — scoped to everyone, or a hand-picked
 * subset of the roster (e.g. 3 friends splitting airfare). Locking
 * immediately is only offered when the current scope selection actually
 * qualifies (organizer, or a solo scope of just the creator) — the server
 * enforces the same rule regardless, this just avoids offering a choice
 * it'll silently override.
 */
export function AddElementForm({
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
  const router = useRouter();
  const [type, setType] = useState<ElementType>("dates");
  const [label, setLabel] = useState(ELEMENT_LABELS.dates);
  const [labelTouched, setLabelTouched] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, string>>(() => emptyMetadataFor("dates"));
  const [scopeMode, setScopeMode] = useState<"everyone" | "custom">("everyone");
  const [customScope, setCustomScope] = useState<Set<string>>(() => new Set([currentUserId]));
  const [state, setState] = useState<"open" | "locked">("open");
  const [lockedValue, setLockedValue] = useState<Record<string, unknown>>(() =>
    applyTripContext("dates", emptyValueFor("dates"), tripContext),
  );
  const [optionsDeadline, setOptionsDeadline] = useState("");
  const [votingDeadline, setVotingDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Self-locking a solo-scoped element used to be reachable here too (scope
  // of exactly {you}), but a regular participant can no longer choose any
  // custom scope at all (organizer-only now, see the "Who's this for"
  // block below) -- only the organizer/co-organizer can lock at creation.
  const canLock = isOrganizer;

  function onTypeChange(next: ElementType) {
    setType(next);
    if (!labelTouched) setLabel(ELEMENT_LABELS[next]);
    setMetadata(emptyMetadataFor(next));
    setLockedValue(applyTripContext(next, emptyValueFor(next), tripContext));
  }

  function toggleScopeMember(userId: string) {
    setCustomScope((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const lockDisabledReason = useMemo(() => {
    if (canLock) return null;
    return "Only the organizer can lock an element in immediately — everyone else's needs a vote.";
  }, [canLock]);

  function submit() {
    setError(null);
    if (state === "locked") {
      const err = validateOptionValue(type, lockedValue, { requireDates: false });
      if (err) return setError(err);
    } else {
      // §1: deadlines are required for every type now (only relevant when
      // open — a locked-at-creation element never has them at all).
      if (!optionsDeadline) return setError("Pick a submission deadline.");
      if (!votingDeadline) return setError("Pick a voting deadline.");
    }
    startTransition(async () => {
      const res = await createElement({
        tripId,
        type,
        label,
        metadata,
        scopeUserIds: scopeMode === "everyone" ? null : Array.from(customScope),
        state,
        optionsDeadline: optionsDeadline || null,
        votingDeadline: votingDeadline || null,
        lockedValue: state === "locked" ? lockedValue : undefined,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/trips/${tripId}/elements/${res.elementId}`);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1.5">
        <span className={labelClass}>Type</span>
        <div className="flex flex-wrap justify-center gap-1.5">
          {ELEMENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTypeChange(t)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                type === t ? pillActiveTeal : pillInactive
              }`}
            >
              {ELEMENT_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Label</span>
        <input
          className={field}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setLabelTouched(true);
          }}
          placeholder={type === "dates" ? "e.g. Rome leg" : "e.g. Friday night dinner"}
        />
      </label>

      <ElementMetadataFields type={type} value={metadata} onChange={setMetadata} />

      {isOrganizer ? (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>Who's this for</span>
          <div className="flex flex-wrap justify-center gap-1.5">
            {(["everyone", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setScopeMode(m)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  scopeMode === m ? pillActiveTeal : pillInactive
                }`}
              >
                {m === "everyone" ? "Everyone" : "Choose people"}
              </button>
            ))}
          </div>
          {scopeMode === "custom" && (
            <ul className="mt-1 flex flex-col gap-1">
              {roster.map((r) => (
                <li key={r.userId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={customScope.has(r.userId)}
                      onChange={() => toggleScopeMember(r.userId)}
                    />
                    {r.displayName}
                    {r.userId === currentUserId && " (you)"}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-brand-muted">
          Visible to everyone on the trip — only the organizer can scope an element to specific
          people.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className={`${labelClass} text-center`}>State</span>
        <div className="flex flex-wrap justify-center gap-1.5">
          <button
            type="button"
            onClick={() => setState("open")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              state === "open" ? pillActiveTeal : pillInactive
            }`}
          >
            Open for voting
          </button>
          <button
            type="button"
            disabled={!canLock}
            onClick={() => setState("locked")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              state === "locked" ? pillActiveTeal : pillInactive
            }`}
          >
            Lock it in now
          </button>
        </div>
        {lockDisabledReason && <p className="text-xs text-brand-muted">{lockDisabledReason}</p>}
      </div>

      {state === "locked" ? (
        <div className="rounded-lg border border-brand-line p-3">
          <span className={`${labelClass} mb-2 block`}>Value</span>
          <ElementValueFields type={type} value={lockedValue} onChange={setLockedValue} requireDates={false} />
        </div>
      ) : (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>
              Submission deadline <span className="text-red-500">*</span>
            </span>
            <input
              type="date"
              required
              className={field}
              value={optionsDeadline}
              onChange={(e) => setOptionsDeadline(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>
              Voting deadline <span className="text-red-500">*</span>
            </span>
            <input
              type="date"
              required
              className={field}
              value={votingDeadline}
              onChange={(e) => setVotingDeadline(e.target.value)}
            />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending || !label.trim() || (state === "open" && (!optionsDeadline || !votingDeadline))}
        className={`self-start px-4 py-2 text-sm ${btnPrimary}`}
      >
        {pending ? "Adding…" : "Add element"}
      </button>
    </div>
  );
}
