"use client";

import { useState, useTransition } from "react";
import { summarizeOptionValue, type ElementType } from "@/lib/trip-elements";
import { castVotes } from "./actions";

type OptionWithScore = {
  id: string;
  value: Record<string, unknown>;
  score: number;
};

/**
 * Tap-to-rank (not drag) up to 3 options. Tapping an already-ranked option
 * removes it; tapping past 3 is a no-op. Editable anytime up to
 * voting_deadline — this just replaces the ranking via castVotes on Save.
 */
export function VotingSection({
  elementId,
  elementType,
  options,
  myRanking,
  votingDeadline,
}: {
  elementId: string;
  elementType: ElementType;
  options: OptionWithScore[];
  myRanking: string[];
  votingDeadline: string | null;
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
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => toggle(opt.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  myRank
                    ? "border-transparent bg-foreground text-background"
                    : "border-black/[.1] hover:bg-black/[.03] dark:border-white/[.14] dark:hover:bg-white/[.05]"
                }`}
              >
                <span className="flex-1">
                  {myRank && <span className="mr-2 font-semibold">#{myRank}</span>}
                  {summarizeOptionValue(elementType, opt.value)}
                </span>
                <span className={myRank ? "opacity-80" : "text-zinc-500"}>
                  #{groupRank} overall
                </span>
              </button>
            </li>
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
