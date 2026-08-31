"use client";

import Image from "next/image";
import {
  ALL_TYPES,
  ELEMENT_LABELS,
  PARTICIPANTS_STATUS_LABELS,
  computeParticipantsStatus,
  normalizeOptionValue,
  summarizeOptionValue,
  type ElementType,
  type ParticipantsValue,
} from "@/lib/trip-elements";
import { resolveIcon } from "@/lib/trip-icons";
import type { WizardDraft } from "../types";

/**
 * Review-screen label only — locked elements read "Settled" except
 * Participants (a locked range still has ongoing fill activity, so it shows
 * its own batch-2 lifecycle instead); open elements always show "Collecting
 * ideas", never blank, regardless of whether any options are seeded yet.
 * This is independent of what create_trip actually stamps into
 * trip_elements.status (which can be null for an empty open element) — that
 * stamping is unchanged.
 */
function StatusBadge({ type, draft }: { type: ElementType; draft: WizardDraft }) {
  const el = draft.elements[type];
  let text: string;

  if (el.choice === "locked" && type === "participants") {
    const value = normalizeOptionValue(
      "participants",
      el.options[0]?.value ?? {},
    ) as ParticipantsValue;
    const status = computeParticipantsStatus({
      min: value.min,
      max: value.max,
      invitesSent: false,
      optedInCount: 0,
    });
    text = PARTICIPANTS_STATUS_LABELS[status];
  } else if (el.choice === "locked") {
    text = "Settled";
  } else {
    text = "Collecting ideas";
  }

  return (
    <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
      {text}
    </span>
  );
}

export function ReviewStep({
  draft,
  onBack,
  onCreate,
  creating,
  error,
}: {
  draft: WizardDraft;
  onBack: () => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
}) {
  const icon = resolveIcon(draft.icon);
  const chosen = ALL_TYPES.filter((t) => draft.elements[t].choice !== "skip");

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Review &amp; create
      </h2>

      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-black/[.1] text-xl dark:border-white/[.14]">
          {icon?.kind === "preset" && <span>{icon.emoji}</span>}
          {icon?.kind === "image" && (
            <Image
              src={icon.url}
              alt=""
              width={48}
              height={48}
              className="h-full w-full object-cover"
              unoptimized
            />
          )}
          {!icon && <span className="text-zinc-400">🧳</span>}
        </div>
        <span className="text-lg font-medium text-black dark:text-zinc-50">
          {draft.name.trim() || "Untitled trip"}
        </span>
      </div>

      {chosen.length === 0 ? (
        <p className="rounded-lg border border-black/[.1] p-3 text-sm text-zinc-500 dark:border-white/[.14]">
          No elements set — you&apos;ll start from a blank trip and add things
          later.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {chosen.map((type) => {
            const el = draft.elements[type];
            return (
              <li
                key={type}
                className="rounded-lg border border-black/[.1] p-3 dark:border-white/[.14]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-black dark:text-zinc-50">
                    {ELEMENT_LABELS[type]}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
                      {el.choice === "locked" ? "Locked" : "Open"}
                    </span>
                    <StatusBadge type={type} draft={draft} />
                  </div>
                </div>

                {el.choice === "open" &&
                  (el.optionsDeadline || el.votingDeadline) && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {el.optionsDeadline && `Options by ${el.optionsDeadline}`}
                      {el.optionsDeadline && el.votingDeadline && " · "}
                      {el.votingDeadline && `Vote by ${el.votingDeadline}`}
                    </p>
                  )}

                {el.options.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {el.options.map((o) => (
                      <li key={o.key}>• {summarizeOptionValue(type, o.value)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">
                    No options seeded.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={creating}
          className="rounded-lg border border-black/[.12] px-4 py-2 text-sm font-medium hover:bg-black/[.03] disabled:opacity-40 dark:border-white/[.16] dark:hover:bg-white/[.05]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="rounded-lg bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {creating ? "Creating…" : "Create trip"}
        </button>
      </div>
    </div>
  );
}
