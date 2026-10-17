"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { keyFactsLine, optionThumbnail, optionTitle, priceWithBasis } from "@/components/option-summary";
import { OptionCompare } from "@/components/option-compare";
import { optionCost } from "@/lib/option-cost";
import { formatCurrency, type ElementType } from "@/lib/trip-elements";
import { castVotes, lockElement, updateOption } from "./actions";

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
const lockPill = `rounded-full border-[1.5px] border-dashed border-brand-accent bg-brand-teal-wash px-3 py-1.5 text-[12.5px] font-semibold text-brand-accent hover:border-solid disabled:opacity-50 ${focusRing}`;
const textBtn = `rounded-sm text-[12.5px] font-semibold text-brand-muted underline underline-offset-2 hover:text-foreground disabled:opacity-50 ${focusRing}`;
const notice = "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-300";
const ORDINAL = ["1st", "2nd", "3rd"];
const MAX_PICKS = 3;

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

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Voting list (restyled to the "Voting and Compare" mockup, 2026-10-17).
 * Ranked voting is unchanged: Vote adds an option to your picks (up to 3,
 * in the order you press), pressing it again removes it. Each press now
 * saves straight away via castVotes (founder: "keep ranked, save
 * instantly") — no Save button. Options stay in the order they loaded so a
 * tile never jumps out from under the pointer.
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
  tripNights = null,
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
  /** The trip's nights, for per-night options with no dates of their own. */
  tripNights?: number | null;
}) {
  const router = useRouter();
  const [ranking, setRanking] = useState<string[]>(myRanking);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "compare">("cards");
  const [lockOpen, setLockOpen] = useState(false);
  const canCompare = !readOnly && options.length >= 2;
  const canLock = !readOnly && (canManage || canLockAny);
  const headcount = eligible || voters;

  // Group standing at load, fixed for this visit (new options go last).
  const scoreSorted = [...options].sort((a, b) => b.score - a.score);
  const [order] = useState(() => scoreSorted.map((o) => o.id));
  const sorted = [
    ...order.map((id) => options.find((o) => o.id === id)).filter((o): o is OptionWithScore => Boolean(o)),
    ...scoreSorted.filter((o) => !order.includes(o.id)),
  ];
  const left = timeLeft(votingDeadline);
  const picked = ranking.map((id) => options.find((o) => o.id === id)).filter((o): o is OptionWithScore => Boolean(o));

  function toggle(optionId: string) {
    if (readOnly || saving) return;
    const previous = ranking;
    const next = previous.includes(optionId)
      ? previous.filter((id) => id !== optionId)
      : previous.length >= MAX_PICKS
        ? previous
        : [...previous, optionId];
    if (next === previous) return;
    setError(null);
    setRanking(next);
    startSaving(async () => {
      const res = await castVotes(elementId, next);
      if (res.error) {
        setRanking(previous);
        setError(`Your vote wasn't saved: ${res.error}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="mt-3 flex flex-col gap-3.5" aria-label={`Vote on ${elementLabel}`}>
      <div className="flex flex-col gap-2">
        {!hideHeader && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="grid size-8 flex-none place-items-center rounded-lg border border-brand-line font-[family-name:var(--font-display)] text-[13px] font-bold text-brand-accent"
              >
                {symbol}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-[family-name:var(--font-display)] text-lg font-bold text-foreground">{elementLabel}</span>
                {left && !readOnly && <span className="block text-[13px] text-brand-muted">Voting closes in {left.replace(" left", "")}</span>}
              </span>
            </span>
            {left && !readOnly && (
              <span
                role="img"
                className="inline-flex flex-none items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
                aria-label={`Voting closes in ${left.replace(" left", "")}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                {left.replace(" left", "")}
              </span>
            )}
          </div>
        )}
        {readOnly ? (
          <p className="text-[13px] text-brand-muted">Submissions are still open — voting opens once the submission deadline passes.</p>
        ) : (
          <div className="flex items-center gap-2.5 text-[12.5px] text-brand-muted">
            <span className="flex-none">
              {voters} of {eligible || voters} have voted
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-line/60" aria-hidden>
              <span
                className="block h-full rounded-full bg-brand-accent"
                style={{ width: `${eligible ? Math.min(100, (voters / eligible) * 100) : 0}%` }}
              />
            </span>
          </div>
        )}
      </div>

      {canCompare && (
        <div role="group" aria-label="View" className="flex w-fit gap-0.5 rounded-full border border-brand-line p-[3px]">
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
          options={sorted.map((o) => ({ id: o.id, value: o.value, votes: o.votes }))}
          myVoteId={ranking[0] ?? null}
          headcount={headcount}
          tripNights={tripNights}
        />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-busy={saving}>
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
                headcount={headcount}
                tripNights={tripNights}
                myRank={!readOnly && rankIndex >= 0 ? rankIndex + 1 : null}
                multiPick={ranking.length > 1}
                full={ranking.length >= MAX_PICKS}
                saving={saving}
                canEdit={canManage || opt.proposedBy === currentUserId}
                readOnly={readOnly}
                onToggle={() => toggle(opt.id)}
              />
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className={notice}>
          {error}
        </p>
      )}

      {!readOnly && (picked.length > 0 || canLock) && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-brand-line pt-3 text-[13px] text-brand-muted">
          <span role="status">
            {picked.length > 0 ? (
              <>
                You voted for <b className="font-semibold text-foreground">{optionTitle(elementType, picked[0].value)}</b>
                {picked.length > 1 && <>, then {joinNames(picked.slice(1).map((o) => optionTitle(elementType, o.value)))}</>}. You can change it
                until voting closes.
              </>
            ) : (
              `Vote for up to ${MAX_PICKS}, your favourite first.`
            )}
          </span>
          {canLock && !lockOpen && (
            <button type="button" onClick={() => setLockOpen(true)} className={lockPill}>
              Lock it in now
            </button>
          )}
        </div>
      )}
      {!readOnly && picked.length === 0 && !canLock && (
        <p className="text-[13px] text-brand-muted">Vote for up to {MAX_PICKS}, your favourite first.</p>
      )}

      {canLock && lockOpen && (
        <LockPanel
          tripId={tripId}
          elementId={elementId}
          elementType={elementType}
          options={scoreSorted}
          onCancel={() => setLockOpen(false)}
        />
      )}
    </section>
  );
}

/** Organizer / creator: pick the winner and end voting now. Defaults to the group's current leader. */
function LockPanel({
  tripId,
  elementId,
  elementType,
  options,
  onCancel,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  options: OptionWithScore[];
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState(options[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-brand-line bg-background p-3.5 text-[13px] text-foreground">
      <p className="font-semibold">Lock in an option now? This ends voting straight away.</p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">Option to lock in</legend>
        {options.map((o, i) => (
          <label key={o.id} className="flex items-center gap-2">
            <input
              type="radio"
              name={`lock-${elementId}`}
              value={o.id}
              checked={choice === o.id}
              onChange={() => setChoice(o.id)}
              className="accent-[var(--brand-accent)]"
            />
            <span className="truncate">{optionTitle(elementType, o.value)}</span>
            {i === 0 && o.score > 0 && <span className="text-[12px] text-brand-muted">· leading</span>}
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className={notice}>
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !choice}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await lockElement(tripId, elementId, choice);
              if (res.error) setError(res.error);
            });
          }}
          className={btnFilled}
        >
          {pending ? "Locking…" : "Lock it in"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={textBtn}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function OptionTile({
  tripId,
  elementId,
  elementType,
  symbol,
  option,
  headcount,
  tripNights,
  myRank,
  multiPick,
  full,
  saving,
  canEdit,
  readOnly = false,
  onToggle,
}: {
  tripId: string;
  elementId: string;
  elementType: ElementType;
  symbol: string;
  option: OptionWithScore;
  headcount: number;
  tripNights: number | null;
  myRank: number | null;
  /** you've picked more than one, so show which place this one has */
  multiPick: boolean;
  /** already 3 picks — unpicked options can't be added */
  full: boolean;
  saving: boolean;
  canEdit: boolean;
  readOnly?: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(option.value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const title = optionTitle(elementType, option.value);

  if (editing) {
    return (
      <li className="rounded-[14px] border-[1.5px] border-brand-line bg-background p-3">
        <ElementValueFields type={elementType} value={draft} onChange={setDraft} />
        {error && <p className={`mt-1.5 ${notice}`}>{error}</p>}
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
  const cost = optionCost(option.value, headcount, tripNights);
  const fallback = priceWithBasis(option.value);
  const price =
    option.value.deposit_required !== true && cost.perPerson != null
      ? { amount: formatCurrency(cost.perPerson, cost.currency), basis: "per person" }
      : fallback;
  const link = typeof option.value.booking_link === "string" ? option.value.booking_link.trim() : "";
  const selected = myRank !== null;
  const initials = option.voterInitials ?? [];

  return (
    <li
      className={`grid grid-cols-[96px_1fr_auto] items-center gap-3.5 rounded-[14px] border-[1.5px] p-2.5 transition-colors max-[560px]:grid-cols-[72px_1fr] ${
        selected ? "border-brand-accent bg-brand-teal-wash" : "border-brand-line bg-background"
      }`}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host
        <img src={thumb} alt="" className="h-20 w-24 rounded-[10px] bg-brand-line/50 object-cover max-[560px]:h-16 max-[560px]:w-[72px]" />
      ) : (
        <span
          aria-hidden
          className="grid h-20 w-24 place-items-center rounded-[10px] bg-brand-line/40 font-[family-name:var(--font-display)] text-base font-bold text-brand-muted max-[560px]:h-16 max-[560px]:w-[72px]"
        >
          {symbol}
        </span>
      )}

      <div className="min-w-0">
        <span className="flex items-center gap-2">
          <h4 className="truncate font-[family-name:var(--font-display)] text-base font-bold text-foreground">{title}</h4>
          {selected && multiPick && (
            <span className="flex-none rounded-full border border-brand-accent px-1.5 py-px text-[10.5px] font-semibold text-brand-accent">
              {ORDINAL[myRank - 1]}
            </span>
          )}
        </span>
        {facts && <p className="mb-1.5 mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-brand-muted">{facts}</p>}
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          {price && (
            <span className="text-[13px] tabular-nums text-brand-muted">
              <b className="font-[family-name:var(--font-display)] text-lg font-bold text-foreground">{price.amount}</b> {price.basis}
            </span>
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-sm text-[12.5px] font-semibold text-brand-accent ${focusRing}`}
            >
              Open listing<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className={textBtn}>
              Edit
            </button>
          )}
        </span>
      </div>

      {!readOnly && (
        <div className="flex flex-col items-end gap-2 max-[560px]:col-span-2 max-[560px]:flex-row max-[560px]:items-center max-[560px]:justify-between">
          <span className="flex items-center gap-1 text-xs text-brand-muted">
            {initials.length > 0 && (
              <span className="flex" aria-hidden>
                {initials.slice(0, 4).map((ini, i) => (
                  <span
                    key={i}
                    className={`grid size-[22px] place-items-center rounded-full border-2 border-background bg-brand-teal-wash font-[family-name:var(--font-display)] text-[9px] font-bold text-brand-accent ${i ? "-ml-1.5" : ""}`}
                  >
                    {ini}
                  </span>
                ))}
              </span>
            )}
            <span>
              {option.votes === 0 ? "No votes" : `${option.votes} vote${option.votes === 1 ? "" : "s"}`}
              {initials.length > 0 && <span className="sr-only">: {initials.join(", ")}</span>}
            </span>
          </span>
          <button
            type="button"
            aria-pressed={selected}
            aria-label={selected ? `Your vote: ${title}${multiPick ? `, ${ORDINAL[myRank - 1]} choice` : ""}. Press to remove.` : `Vote for ${title}`}
            disabled={saving || (!selected && full)}
            title={!selected && full ? `You've picked ${MAX_PICKS}. Remove one to vote for this.` : undefined}
            onClick={onToggle}
            className={`h-9 min-w-[84px] rounded-[10px] border-[1.5px] border-brand-accent px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 ${focusRing} ${
              selected ? "bg-brand-accent text-background" : "bg-transparent text-brand-accent hover:bg-brand-teal-wash"
            }`}
          >
            {selected ? "Your vote" : "Vote"}
          </button>
        </div>
      )}
    </li>
  );
}
