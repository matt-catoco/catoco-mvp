"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { ElementMetadataFields } from "@/components/element-metadata-fields";
import {
  ELEMENT_LABELS,
  ELEMENT_TYPES,
  emptyMetadataFor,
  emptyValueFor,
  validateOptionValue,
  type ElementType,
} from "@/lib/trip-elements";
import { createElement } from "./actions";

const field =
  "h-10 w-full rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";
const labelClass = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

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
}: {
  tripId: string;
  currentUserId: string;
  isOrganizer: boolean;
  roster: RosterEntry[];
}) {
  const router = useRouter();
  const [type, setType] = useState<ElementType>("dates");
  const [label, setLabel] = useState(ELEMENT_LABELS.dates);
  const [labelTouched, setLabelTouched] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, string>>(() => emptyMetadataFor("dates"));
  const [scopeMode, setScopeMode] = useState<"everyone" | "custom">("everyone");
  const [customScope, setCustomScope] = useState<Set<string>>(() => new Set([currentUserId]));
  const [state, setState] = useState<"open" | "locked">("open");
  const [lockedValue, setLockedValue] = useState<Record<string, unknown>>(() => emptyValueFor("dates"));
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
    setLockedValue(emptyValueFor(next));
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
      const err = validateOptionValue(type, lockedValue);
      if (err) return setError(err);
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
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Type</span>
        <select
          className={field}
          value={type}
          onChange={(e) => onTypeChange(e.target.value as ElementType)}
        >
          {ELEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ELEMENT_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Label</span>
        <input
          className={field}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setLabelTouched(true);
          }}
          placeholder="e.g. Friday night dinner"
        />
      </label>

      <ElementMetadataFields type={type} value={metadata} onChange={setMetadata} />

      {isOrganizer ? (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>Who's this for</span>
          <div className="flex gap-1.5">
            {(["everyone", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setScopeMode(m)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  scopeMode === m
                    ? "border-transparent bg-foreground text-background"
                    : "border-black/[.12] text-zinc-600 hover:bg-black/[.03] dark:border-white/[.16] dark:text-zinc-400 dark:hover:bg-white/[.05]"
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
        <p className="text-xs text-zinc-500">
          Visible to everyone on the trip — only the organizer can scope an element to specific
          people.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className={labelClass}>State</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setState("open")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              state === "open"
                ? "border-transparent bg-foreground text-background"
                : "border-black/[.12] text-zinc-600 hover:bg-black/[.03] dark:border-white/[.16] dark:text-zinc-400 dark:hover:bg-white/[.05]"
            }`}
          >
            Open for voting
          </button>
          <button
            type="button"
            disabled={!canLock}
            onClick={() => setState("locked")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              state === "locked"
                ? "border-transparent bg-foreground text-background"
                : "border-black/[.12] text-zinc-600 hover:bg-black/[.03] dark:border-white/[.16] dark:text-zinc-400 dark:hover:bg-white/[.05]"
            }`}
          >
            Lock it in now
          </button>
        </div>
        {lockDisabledReason && <p className="text-xs text-zinc-500">{lockDisabledReason}</p>}
      </div>

      {state === "locked" ? (
        <div className="rounded-lg border border-black/[.08] p-3 dark:border-white/[.1]">
          <span className={`${labelClass} mb-2 block`}>Value</span>
          <ElementValueFields type={type} value={lockedValue} onChange={setLockedValue} />
        </div>
      ) : (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Submission deadline (optional)</span>
            <input
              type="date"
              className={field}
              value={optionsDeadline}
              onChange={(e) => setOptionsDeadline(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Voting deadline (optional)</span>
            <input
              type="date"
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
        disabled={pending || !label.trim()}
        className="self-start rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Adding…" : "Add element"}
      </button>
    </div>
  );
}
