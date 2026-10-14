"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { keyFactsLine, optionThumbnail, optionTitle, priceWithBasis } from "@/components/option-summary";
import { OptionCompare } from "@/components/option-compare";
import type { ElementType } from "@/lib/trip-elements";
import { castVotes, lockElement, updateOption } from "./actions";
import { btnCommit } from "@/lib/ui";

type OptionWithScore = {
  id: string;
  value: Record<string, unknown>;
  score: number;
  /** how many people put this option in their ranking */
  votes: number;
  /** voters' display-name initials — only when the trip's "Show who voted"
   * setting is on (null otherwise); never full names or emails */
  voterInitials?: string[] | null;
  proposedBy: string | null;
};

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const btnFilled = `inline-flex h-9 items-center justify-center rounded-[10px] bg-brand-teal px-3.5 text-[13px] font-semibold text-[#0d2020] transition-opacity hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const btnVote = `inline-flex h-11 min-w-[7.5rem] items-center justify-center rounded-xl bg-brand-teal px-5 font-[family-name:var(--font-display)] text-[15px] font-bold text-[#0d2020] transition-colors hover:bg-brand-teal-deep hover:text-white disabled:opacity-50 ${focusRing}`;
const btnVoted = `inline-flex h-11 min-w-[7.5rem] items-center justify-center rounded-xl border-[1.5px] border-brand-accent bg-brand-teal-wash px-5 font-[family-name:var(--font-display)] text-[15px] font-bold text-brand-accent ${focusRing}`;
const lockPill = `rounded-full border-[1.5px] border-dashed border-brand-teal-deep bg-brand-teal-wash px-3 py-1 text-[12.5px] font-semibold text-brand-accent hover:border-solid ${focusRing}`;
const textBtn = `rounded-sm text-[12.5px] font-semibold text-brand-muted underline underline-offset-2 hover:text-foreground disabled:opacity-50 ${focusRing}`;
const errorText = "text-[13px] text-brand-coral";
const ORDINAL = ["1st", "2nd", "3rd"];

/** "3d left" / "5h left" / "40m left" until the voting deadline. */
function timeLeft(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m left`;
  if (h < 48) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

/**
 * Voting list (restyled to match the element cards, 2026-10-14). Ranked
 * voting is unchanged: Vote adds an option to your picks (up to 3, in the
 * order you press), pressing it again removes it, and Save sends the
 * ranking via castVotes — editable until voting closes. Tiles are ordered
 * by your picks first, then by group standing.
 */
export function VotingSection({
  tripId,
  elementId,
  elementType,
  symbol,
  elementLabel,
  options,
  myRanking,
  votingDeadline,
  voters,
  eligible,
  currentUserId,
  canManage,
  canLockAny = false,
  readOnly = false,
  hideHeader = false,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  symbol: string;
  elementLabel: string;
  options: OptionWithScore[];
  myRanking: string[];
  votingDeadline: string | null;
  /** people who've voted / people who can (opted-in element participants) */
  voters: number;
  eligible: number;
  currentUserId: string;
  canManage: boolean;
  /** Lock rights beyond canManage — the element's creator when the trip lets
   * participants add elements (lock_element() re-checks). */
  canLockAny?: boolean;
  /** Submission phase (before options_deadline) — options are visible but
   * not yet rankable. §11: the propose form and ranking never show at once. */
  readOnly?: boolean;
  /** The element page's card header already shows the badge, name and clock. */
  hideHeader?: boolean;
}) {
  const router = useRouter();
  const [ranking, setRanking] = useState<string[]>(myRanking);
  const [saved, setSaved] = useState<string[]>(myRanking);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "compare">("cards");
  const dirty = ranking.join(",") !== saved.join(",");
  const canCompare = !readOnly && options.length >= 2;
  const canLock = !readOnly && (canManage || canLockAny);

  const scoreSorted = [...options].sort((a, b) => b.score - a.score);
  const rankedIds = readOnly ? [] : ranking;
  const rankedOptions = rankedIds
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is OptionWithScore => Boolean(o));
  const sorted = [...rankedOptions, ...scoreSorted.filter((o) => !rankedIds.includes(o.id))];
  const left = timeLeft(votingDeadline);
  const firstChoice = options.find((o) => o.id === saved[0]);

  // FLIP reorder animation (unchanged): tiles glide into their new slot.
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
      setSaved(ranking);
      router.refresh();
    });
  }

  return (
    <section className="mt-3 flex flex-col gap-3" aria-label={`Vote on ${elementLabel}`}>
      {/* Header: badge, name, deadline clock; then the turnout line. */}
      <div className="flex flex-col gap-1.5">
        {!hideHeader && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-9 flex-none place-items-center rounded-lg border border-brand-line font-[family-name:var(--font-display)] text-base font-bold text-foreground"
            >
              {symbol}
            </span>
            <span className="truncate font-[family-name:var(--font-display)] text-lg font-bold text-foreground">{elementLabel}</span>
          </span>
          {left && !readOnly && (
            <span
              className="inline-flex flex-none items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
              aria-label={`Voting closes, ${left}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {left}
            </span>
          )}
        </div>
        )}
        {readOnly ? (
          <p className="text-[13px] text-brand-muted">Submissions are still open — voting opens once the submission deadline passes.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] text-brand-muted">
              <b className="font-semibold text-foreground">{voters}</b> of {eligible || voters} have voted
              {options.length > 1 && " · pick up to 3, in order"}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-brand-line/60" aria-hidden>
              <div className="h-full rounded-full bg-brand-teal" style={{ width: `${eligible ? Math.min(100, (voters / eligible) * 100) : 0}%` }} />
            </div>
          </div>
        )}
      </div>

      {canCompare && (
        <div role="group" aria-label="View" className="flex w-fit gap-1 rounded-full border border-brand-line p-1">
          {(["cards", "compare"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-3.5 py-1 text-[13px] font-semibold transition-colors ${focusRing} ${
                view === v ? "bg-foreground text-background" : "text-brand-muted hover:text-foreground"
              }`}
            >
              {v === "cards" ? "Cards" : "Compare"}
            </button>
          ))}
        </div>
      )}

      {canCompare && view === "compare" ? (
        <OptionCompare
          type={elementType}
          symbol={symbol}
          options={scoreSorted.map((o) => ({ id: o.id, value: o.value }))}
          myVoteId={saved[0] ?? null}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sorted.map((opt) => {
            const rankIndex = ranking.indexOf(opt.id);
            return (
              <OptionTile
                key={opt.id}
                tripId={tripId}
                elementId={elementId}
                elementType={elementType}
                symbol={symbol}
                option={opt}
                myRank={!readOnly && rankIndex >= 0 ? rankIndex + 1 : null}
                full={ranking.length >= 3}
                canEdit={canManage || opt.proposedBy === currentUserId}
                canLock={canLock}
                readOnly={readOnly}
                onToggle={() => toggle(opt.id)}
                registerNode={registerNode}
              />
            );
          })}
        </ul>
      )}

      {!readOnly && error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}

      {!readOnly && dirty && (
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={save} disabled={pending} className={btnCommit}>
            {pending ? "Saving…" : "Save my vote"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setRanking(saved);
              setError(null);
            }}
            className={textBtn}
          >
            Undo changes
          </button>
        </div>
      )}

      {!readOnly && !dirty && firstChoice && (
        <p className="text-[13px] text-brand-muted" role="status">
          You voted for <b className="font-semibold text-foreground">{optionTitle(elementType, firstChoice.value)}</b>. You can
          change it until voting closes.
        </p>
      )}
    </section>
  );
}

function OptionTile({
  tripId,
  elementId,
  elementType,
  symbol,
  option,
  myRank,
  full,
  canEdit,
  canLock,
  readOnly = false,
  onToggle,
  registerNode,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  symbol: string;
  option: OptionWithScore;
  myRank: number | null;
  /** already 3 picks — unpicked options can't be added */
  full: boolean;
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

  const title = optionTitle(elementType, option.value);
  const tileBase = "rounded-2xl border-[1.5px] p-3";

  if (editing) {
    return (
      <li ref={(el) => registerNode(option.id, el)} className={`${tileBase} border-brand-line`}>
        <ElementValueFields type={elementType} value={draft} onChange={setDraft} />
        {error && <p className={`mt-1.5 ${errorText}`}>{error}</p>}
        <div className="mt-2.5 flex items-center gap-3">
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
            className={btnFilled}
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
            className={textBtn}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  const thumb = optionThumbnail(elementType, option.value);
  const facts = keyFactsLine(elementType, option.value);
  const price = priceWithBasis(option.value);
  const link = typeof option.value.booking_link === "string" ? option.value.booking_link.trim() : "";
  const selected = myRank !== null;

  return (
    <li
      ref={(el) => registerNode(option.id, el)}
      className={`${tileBase} transition-colors ${selected ? "border-brand-accent bg-brand-teal-wash" : "border-brand-line"}`}
    >
      <div className="flex gap-3">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host
          <img src={thumb} alt="" className="size-16 flex-none rounded-xl bg-brand-line/50 object-cover sm:size-20" />
        ) : (
          <span
            aria-hidden
            className="grid size-16 flex-none place-items-center rounded-xl bg-brand-line/40 font-[family-name:var(--font-display)] text-base font-bold text-brand-muted sm:size-20"
          >
            {symbol}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate font-[family-name:var(--font-display)] text-[15px] font-bold leading-tight text-foreground">
              {title}
            </span>
            {selected && (
              <span className="flex-none rounded-full border border-brand-accent px-1.5 py-px text-[10.5px] font-semibold text-brand-accent">
                {ORDINAL[myRank - 1]}
              </span>
            )}
          </span>
          {facts && <span className="line-clamp-2 text-[12.5px] leading-snug text-brand-muted">{facts}</span>}
          <span className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-1">
            {price && (
              <span className="text-[12.5px] text-brand-muted">
                <b className="font-[family-name:var(--font-display)] text-[15px] font-bold text-foreground">{price.amount}</b>{" "}
                {price.basis}
              </span>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className={`rounded-sm text-[12.5px] font-semibold text-brand-accent underline underline-offset-2 ${focusRing}`}
              >
                Open listing ↗
              </a>
            )}
          </span>
        </div>
      </div>

      {confirmingLock ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p>
            Lock in &ldquo;{title}&rdquo; now? This ends voting immediately — no confirmation from anyone else needed.
          </p>
          {lockError && (
            <p role="alert" className={`mt-1.5 ${errorText}`}>
              {lockError}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-3">
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
              className={btnFilled}
            >
              {lockPending ? "Locking…" : "Lock it in"}
            </button>
            <button
              type="button"
              disabled={lockPending}
              onClick={() => {
                setLockError(null);
                setConfirmingLock(false);
              }}
              className={textBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-brand-line/70 pt-2.5">
          <span className="flex items-center gap-3">
            {!readOnly && (
              <span className="flex items-center gap-2">
                {option.voterInitials && option.voterInitials.length > 0 && (
                  <span className="flex -space-x-0.5" aria-hidden>
                    {option.voterInitials.slice(0, 3).map((ini, i) => (
                      <span
                        key={i}
                        className="grid size-6 place-items-center rounded-full border-[1.5px] border-background bg-brand-teal-wash font-[family-name:var(--font-display)] text-[9.5px] font-bold text-brand-accent ring-1 ring-brand-accent/40"
                      >
                        {ini}
                      </span>
                    ))}
                    {option.voterInitials.length > 3 && (
                      <span className="grid size-6 place-items-center rounded-full border-[1.5px] border-background bg-brand-line text-[9.5px] font-bold text-foreground">
                        +{option.voterInitials.length - 3}
                      </span>
                    )}
                  </span>
                )}
                <span className="text-[12.5px] text-brand-muted">
                  {option.votes === 0 ? "No votes" : `${option.votes} vote${option.votes === 1 ? "" : "s"}`}
                  {option.voterInitials && option.voterInitials.length > 0 && (
                    <span className="sr-only">: {option.voterInitials.join(", ")}</span>
                  )}
                </span>
              </span>
            )}
            {canEdit && (
              <button type="button" onClick={() => setEditing(true)} className={textBtn}>
                Edit
              </button>
            )}
            {canLock && (
              <button type="button" onClick={() => setConfirmingLock(true)} className={lockPill}>
                Lock it in now
              </button>
            )}
          </span>
          {!readOnly && (
            <button
              type="button"
              aria-pressed={selected}
              aria-label={selected ? `Your vote: ${title}, ${ORDINAL[myRank - 1]} choice. Press to remove.` : `Vote for ${title}`}
              disabled={!selected && full}
              onClick={onToggle}
              className={selected ? btnVoted : btnVote}
            >
              {selected ? "✓ Your vote" : "Vote"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
