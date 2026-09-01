"use client";

import { useState, useTransition } from "react";
import { ElementValueFields } from "@/components/element-value-fields";
import { OptionSummary } from "@/components/option-summary";
import { summarizeOptionValue, type ElementType } from "@/lib/trip-elements";
import { castVotes, lockElement, updateOption } from "./actions";

type OptionWithScore = {
  id: string;
  value: Record<string, unknown>;
  score: number;
  proposedBy: string | null;
};

/**
 * Tap-to-rank (not drag) up to 3 options. Tapping an already-ranked option
 * removes it; tapping past 3 is a no-op. Editable anytime up to
 * voting_deadline — this just replaces the ranking via castVotes on Save.
 */
export function VotingSection({
  tripId,
  elementId,
  elementType,
  options,
  myRanking,
  votingDeadline,
  currentUserId,
  canManage,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  options: OptionWithScore[];
  myRanking: string[];
  votingDeadline: string | null;
  currentUserId: string;
  canManage: boolean;
}) {
  const [ranking, setRanking] = useState<string[]>(myRanking);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sorted = [...options].sort((a, b) => b.score - a.score);
  const deadlineLabel = votingDeadline ? votingDeadline.slice(0, 10) : null;

  function toggle(optionId: string) {
    setError(null);
    setDirty(true);
    setRanking((prev) => {
      if (prev.includes(optionId)) return prev.filter((id) => id !== optionId);
      if (prev.length >= 3) return prev;
      return [...prev, optionId];
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await castVotes(elementId, ranking);
      if (res.error) setError(res.error);
      else setDirty(false);
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="rounded-lg bg-black/[.03] px-3 py-2 text-xs text-zinc-600 dark:bg-white/[.05] dark:text-zinc-400">
        {options.length === 1
          ? `This is the only option${deadlineLabel ? ` — it locks in automatically on ${deadlineLabel} unless another is added` : ""}.`
          : deadlineLabel
            ? `Top choice locks in automatically on ${deadlineLabel} — no confirmation needed.`
            : "Top choice locks in automatically once a voting deadline is set — no confirmation needed."}
      </p>

      <ul className="flex flex-col gap-1.5">
        {sorted.map((opt, index) => {
          const rankIndex = ranking.indexOf(opt.id);
          const myRank = rankIndex >= 0 ? rankIndex + 1 : null;
          // Current standing across everyone's votes — the list is already
          // sorted by score, this just labels the position instead of
          // showing raw points (which don't mean anything on their own).
          const groupRank = index + 1;
          const canEdit = canManage || opt.proposedBy === currentUserId;
          return (
            <OptionRow
              key={opt.id}
              tripId={tripId}
              elementId={elementId}
              elementType={elementType}
              option={opt}
              myRank={myRank}
              groupRank={groupRank}
              canEdit={canEdit}
              canLock={canManage}
              onToggle={() => toggle(opt.id)}
            />
          );
        })}
      </ul>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="self-start rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save my ranking"}
        </button>
      )}
    </div>
  );
}

function OptionRow({
  tripId,
  elementId,
  elementType,
  option,
  myRank,
  groupRank,
  canEdit,
  canLock,
  onToggle,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  option: OptionWithScore;
  myRank: number | null;
  groupRank: number;
  canEdit: boolean;
  canLock: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingLock, setConfirmingLock] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(option.value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lockPending, startLockTransition] = useTransition();
  const [lockError, setLockError] = useState<string | null>(null);

  if (confirmingLock) {
    return (
      <li className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
        <p className="text-amber-800 dark:text-amber-300">
          Lock in &ldquo;{summarizeOptionValue(elementType, option.value)}&rdquo; now? This ends
          voting immediately — no confirmation from anyone else needed.
        </p>
        {lockError && <p className="mt-1.5 text-red-500">{lockError}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={lockPending}
            onClick={() => {
              setLockError(null);
              startLockTransition(async () => {
                const res = await lockElement(tripId, elementId, option.id);
                if (res.error) {
                  setLockError(res.error);
                  return;
                }
                setConfirmingLock(false);
              });
            }}
            className="rounded-lg bg-foreground px-3 py-1.5 font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {lockPending ? "Locking…" : "Confirm lock"}
          </button>
          <button
            type="button"
            disabled={lockPending}
            onClick={() => {
              setLockError(null);
              setConfirmingLock(false);
            }}
            className="text-zinc-500 underline hover:text-black dark:hover:text-zinc-50 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-black/[.1] p-3 dark:border-white/[.14]">
        <ElementValueFields type={elementType} value={draft} onChange={setDraft} />
        {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await updateOption(option.id, tripId, elementId, elementType, draft);
                if (res.error) {
                  setError(res.error);
                  return;
                }
                setEditing(false);
              });
            }}
            className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(option.value);
              setError(null);
              setEditing(false);
            }}
            className="text-xs text-zinc-500 underline hover:text-red-500 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        className={`flex flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
          myRank
            ? "border-transparent bg-foreground text-background"
            : "border-black/[.1] hover:bg-black/[.03] dark:border-white/[.14] dark:hover:bg-white/[.05]"
        }`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {myRank && <span className="shrink-0 font-semibold">#{myRank}</span>}
          <OptionSummary type={elementType} value={option.value} />
        </span>
        <span className={`shrink-0 ${myRank ? "opacity-80" : "text-zinc-500"}`}>
          #{groupRank} overall
        </span>
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs text-zinc-500 underline hover:text-black dark:hover:text-zinc-50"
        >
          Edit
        </button>
      )}
      {canLock && (
        <button
          type="button"
          onClick={() => setConfirmingLock(true)}
          className="shrink-0 text-xs text-zinc-500 underline hover:text-black dark:hover:text-zinc-50"
        >
          Lock this in
        </button>
      )}
    </li>
  );
}
