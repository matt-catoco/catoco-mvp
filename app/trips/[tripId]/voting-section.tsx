"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  readOnly = false,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  options: OptionWithScore[];
  myRanking: string[];
  votingDeadline: string | null;
  currentUserId: string;
  canManage: boolean;
  /** Submission phase (before options_deadline) — options are visible but
   * not yet rankable. §11: the two phases must never show both the propose
   * form and ranking UI at once; this is the "show the list, not the
   * ranking" half of that gate. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [ranking, setRanking] = useState<string[]>(myRanking);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // §10: tiles are ordered by current standing (group score) by default, but
  // your own picks jump to the top in rank order the moment you tap them —
  // the reorder is what makes tap-to-rank legible as a real ranking instead
  // of a set of checkboxes. groupRank (shown on every tile) still reflects
  // the score-only order regardless, so "#2 overall" never changes just
  // because you personally reordered the list.
  const scoreSorted = [...options].sort((a, b) => b.score - a.score);
  const groupRankById = new Map(scoreSorted.map((o, i) => [o.id, i + 1]));
  const rankedIds = readOnly ? [] : ranking;
  const rankedOptions = rankedIds
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is OptionWithScore => Boolean(o));
  const remaining = scoreSorted.filter((o) => !rankedIds.includes(o.id));
  const sorted = [...rankedOptions, ...remaining];
  const deadlineLabel = votingDeadline ? votingDeadline.slice(0, 10) : null;

  // FLIP reorder animation: capture each tile's position before a reorder,
  // then on the next layout, offset it back to where it was and transition
  // to zero — the tile appears to glide into its new slot instead of
  // snapping there. No animation library involved, just getBoundingClientRect
  // before/after (the standard FLIP technique).
  const nodeRefs = useRef(new Map<string, HTMLLIElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const registerNode = (id: string, el: HTMLLIElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  };
  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    nodeRefs.current.forEach((el, id) => nextRects.set(id, el.getBoundingClientRect()));
    nodeRefs.current.forEach((el, id) => {
      const prev = prevRects.current.get(id);
      const next = nextRects.get(id);
      if (!prev || !next) return;
      const dy = prev.top - next.top;
      if (!dy) return;
      el.style.transform = `translateY(${dy}px)`;
      el.style.transition = "transform 0s";
      requestAnimationFrame(() => {
        el.style.transform = "";
        el.style.transition = "transform 250ms ease";
      });
    });
    prevRects.current = nextRects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.map((o) => o.id).join(",")]);

  function toggle(optionId: string) {
    if (readOnly) return;
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
      if (res.error) {
        setError(res.error);
        return;
      }
      setDirty(false);
      // castVotes revalidates the path server-side, but this component's own
      // props (options[].score, myRanking) are whatever was passed at the
      // last render — without a refresh, the "#N overall" score badges keep
      // showing the pre-vote standing until something else happens to
      // reload the page, which reads as "my vote didn't count."
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="rounded-lg bg-black/[.03] px-3 py-2 text-xs text-zinc-600 dark:bg-white/[.05] dark:text-zinc-400">
        {readOnly
          ? "Submissions are still open — ranking opens once the submission deadline passes."
          : options.length === 1
            ? `This is the only option${deadlineLabel ? ` — it locks in automatically on ${deadlineLabel} unless another is added` : ""}.`
            : deadlineLabel
              ? `Top choice locks in automatically on ${deadlineLabel} — no confirmation needed.`
              : "Top choice locks in automatically once a voting deadline is set — no confirmation needed."}
      </p>

      <ul className="flex flex-col gap-3">
        {sorted.map((opt) => {
          const rankIndex = ranking.indexOf(opt.id);
          const myRank = !readOnly && rankIndex >= 0 ? rankIndex + 1 : null;
          const groupRank = groupRankById.get(opt.id) ?? 0;
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
              canLock={!readOnly && canManage}
              readOnly={readOnly}
              onToggle={() => toggle(opt.id)}
              registerNode={registerNode}
            />
          );
        })}
      </ul>

      {!readOnly && error && <p className="text-xs text-red-500">{error}</p>}

      {!readOnly && dirty && (
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
  readOnly = false,
  onToggle,
  registerNode,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  option: OptionWithScore;
  myRank: number | null;
  groupRank: number;
  canEdit: boolean;
  canLock: boolean;
  readOnly?: boolean;
  onToggle: () => void;
  registerNode: (id: string, el: HTMLLIElement | null) => void;
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
      <li
        ref={(el) => registerNode(option.id, el)}
        className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
      >
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
      <li
        ref={(el) => registerNode(option.id, el)}
        className="rounded-lg border border-black/[.1] p-3 dark:border-white/[.14]"
      >
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

  const cardInner = (
    <>
      {!readOnly && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {myRank ? <span className="font-semibold">#{myRank}</span> : <span />}
          <span className={myRank ? "opacity-80" : "text-zinc-500"}>#{groupRank} overall</span>
        </div>
      )}
      <OptionSummary type={elementType} value={option.value} />
    </>
  );

  return (
    <li
      ref={(el) => registerNode(option.id, el)}
      className={`overflow-hidden rounded-lg border text-xs transition-colors ${
        myRank
          ? "border-transparent bg-foreground text-background"
          : "border-black/[.1] dark:border-white/[.14]"
      }`}
    >
      {readOnly ? (
        <div className="block w-full p-2.5 text-left">{cardInner}</div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className={`block w-full p-2.5 text-left ${
            myRank ? "" : "hover:bg-black/[.03] dark:hover:bg-white/[.05]"
          }`}
        >
          {cardInner}
        </button>
      )}
      {(canEdit || canLock) && (
        <div
          className={`flex items-center gap-3 border-t px-2.5 py-1.5 ${
            myRank ? "border-background/20" : "border-black/[.08] dark:border-white/[.1]"
          }`}
        >
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`underline ${myRank ? "opacity-80 hover:opacity-100" : "text-zinc-500 hover:text-black dark:hover:text-zinc-50"}`}
            >
              Edit
            </button>
          )}
          {canLock && (
            <button
              type="button"
              onClick={() => setConfirmingLock(true)}
              className={`underline ${myRank ? "opacity-80 hover:opacity-100" : "text-zinc-500 hover:text-black dark:hover:text-zinc-50"}`}
            >
              Lock this in
            </button>
          )}
        </div>
      )}
    </li>
  );
}
