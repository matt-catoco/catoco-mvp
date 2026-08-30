"use client";

import {
  ELEMENT_BLURBS,
  ELEMENT_LABELS,
  categoryOf,
  emptyValueFor,
  validateOptionValue,
  type ElementType,
} from "@/lib/trip-elements";
import { ElementValueFields } from "./element-value-fields";
import type { ElementChoice, ElementDraft } from "./types";

const CHOICES: { value: ElementChoice; label: string; hint: string }[] = [
  { value: "skip", label: "Skip", hint: "Decide later" },
  { value: "locked", label: "Lock", hint: "One fixed value" },
  { value: "open", label: "Open", hint: "Group votes on options" },
];

function newOption(type: ElementType) {
  return { key: crypto.randomUUID(), value: emptyValueFor(type) };
}

export function ElementCard({
  type,
  draft,
  onChange,
}: {
  type: ElementType;
  draft: ElementDraft;
  onChange: (next: ElementDraft) => void;
}) {
  const selectChoice = (choice: ElementChoice) => {
    if (choice === "locked") {
      onChange({
        ...draft,
        choice,
        options: draft.options.length ? [draft.options[0]] : [newOption(type)],
      });
    } else {
      onChange({ ...draft, choice });
    }
  };

  const setOption = (index: number, value: Record<string, unknown>) => {
    const options = draft.options.map((o, i) => (i === index ? { ...o, value } : o));
    onChange({ ...draft, options });
  };

  const addOption = () =>
    onChange({ ...draft, options: [...draft.options, newOption(type)] });

  const removeOption = (index: number) =>
    onChange({ ...draft, options: draft.options.filter((_, i) => i !== index) });

  return (
    <div className="rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
            {ELEMENT_LABELS[type]}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {ELEMENT_BLURBS[type]}
          </p>
        </div>
        <span className="rounded-full border border-black/[.1] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.14]">
          {categoryOf(type)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {CHOICES.map((c) => {
          const active = draft.choice === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => selectChoice(c.value)}
              className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                active
                  ? "border-transparent bg-foreground text-background"
                  : "border-black/[.12] hover:bg-black/[.03] dark:border-white/[.16] dark:hover:bg-white/[.05]"
              }`}
            >
              <span className="block text-xs font-medium">{c.label}</span>
              <span
                className={`block text-[10px] ${active ? "opacity-80" : "text-zinc-500"}`}
              >
                {c.hint}
              </span>
            </button>
          );
        })}
      </div>

      {draft.choice === "locked" && draft.options[0] && (
        <div className="mt-4">
          <ElementValueFields
            type={type}
            value={draft.options[0].value}
            onChange={(v) => setOption(0, v)}
          />
          <FieldError type={type} value={draft.options[0].value} />
        </div>
      )}

      {draft.choice === "open" && (
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Voting deadline (optional)
            </span>
            <input
              type="date"
              className="h-10 w-full max-w-[220px] rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]"
              value={draft.deadline}
              onChange={(e) => onChange({ ...draft, deadline: e.target.value })}
            />
          </label>

          {draft.options.length === 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No options yet — the group can propose them later, or seed a few
              now.
            </p>
          )}

          {draft.options.map((opt, i) => (
            <div
              key={opt.key}
              className="rounded-lg border border-black/[.08] p-3 dark:border-white/[.1]"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-zinc-500">Option {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="text-xs text-zinc-500 underline hover:text-red-500"
                >
                  Remove
                </button>
              </div>
              <ElementValueFields
                type={type}
                value={opt.value}
                onChange={(v) => setOption(i, v)}
              />
              <FieldError type={type} value={opt.value} />
            </div>
          ))}

          <button
            type="button"
            onClick={addOption}
            className="self-start rounded-lg border border-black/[.12] px-3 py-1.5 text-xs font-medium hover:bg-black/[.03] dark:border-white/[.16] dark:hover:bg-white/[.05]"
          >
            + Add option
          </button>
        </div>
      )}
    </div>
  );
}

function FieldError({
  type,
  value,
}: {
  type: ElementType;
  value: Record<string, unknown>;
}) {
  // Only nag once the user has typed something.
  const touched = Object.values(value).some((v) => String(v ?? "").trim() !== "");
  const err = touched ? validateOptionValue(type, value) : null;
  if (!err) return null;
  return <p className="mt-1.5 text-xs text-red-500">{err}</p>;
}
