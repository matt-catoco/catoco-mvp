"use client";

import {
  MACRO_TYPES,
  MICRO_TYPES,
  validateDeadlines,
  validateOptionValue,
  type ElementCategory,
  type ElementType,
} from "@/lib/trip-elements";
import { ElementCard } from "../element-card";
import { WizardNav } from "./wizard-nav";
import type { ElementDraft, WizardDraft } from "../types";

function elementComplete(type: ElementType, el: ElementDraft): boolean {
  if (el.choice === "skip") return true;
  if (el.choice === "locked") {
    return el.options.length === 1 && !validateOptionValue(type, el.options[0].value);
  }
  // open: any seeded option must be valid, deadlines must be in order; zero
  // options is allowed
  return (
    el.options.every((o) => !validateOptionValue(type, o.value)) &&
    !validateDeadlines(el.optionsDeadline, el.votingDeadline)
  );
}

export function ElementsStep({
  category,
  draft,
  setElement,
  onNext,
  onBack,
}: {
  category: ElementCategory;
  draft: WizardDraft;
  setElement: (type: ElementType, next: ElementDraft) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const types: readonly ElementType[] =
    category === "macro" ? MACRO_TYPES : MICRO_TYPES;

  const macroSet = MACRO_TYPES.some(
    (t) => draft.elements[t].choice !== "skip",
  );
  const allValid = types.every((t) => elementComplete(t, draft.elements[t]));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {category === "macro" ? "Macro elements" : "Micro elements"}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {category === "macro"
            ? "The big-picture pieces. Skip anything you're not ready to decide."
            : "The on-the-ground details. All optional for now."}
        </p>
      </div>

      {category === "micro" && !macroSet && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          You haven&apos;t set any macro elements yet. These still work, but a date
          or destination first usually makes them more useful.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {types.map((type) => (
          <ElementCard
            key={type}
            type={type}
            draft={draft.elements[type]}
            onChange={(next) => setElement(type, next)}
          />
        ))}
      </div>

      {!allValid && (
        <p className="text-xs text-red-500">
          Fix the highlighted fields, or set those elements to Skip.
        </p>
      )}

      <WizardNav
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!allValid}
        nextLabel={category === "macro" ? "Next: micro elements" : "Review"}
      />
    </div>
  );
}
