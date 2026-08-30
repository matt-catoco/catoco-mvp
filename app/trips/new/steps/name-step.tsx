"use client";

import { IconPicker } from "../icon-picker";
import { WizardNav } from "./wizard-nav";
import type { WizardDraft } from "../types";

export function NameStep({
  draft,
  setDraft,
  userId,
  onNext,
  onBack,
}: {
  draft: WizardDraft;
  setDraft: (updater: (d: WizardDraft) => WizardDraft) => void;
  userId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const nameOk = draft.name.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Name the trip
      </h2>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Trip name
        </span>
        <input
          autoFocus
          value={draft.name}
          maxLength={120}
          onChange={(e) =>
            setDraft((d) => ({ ...d, name: e.target.value }))
          }
          placeholder="e.g. Sam's 30th in Portugal"
          className="h-11 rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && nameOk) onNext();
          }}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Icon
        </span>
        <IconPicker
          value={draft.icon}
          userId={userId}
          onChange={(icon) => setDraft((d) => ({ ...d, icon }))}
        />
      </div>

      <WizardNav
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!nameOk}
        nextLabel="Next: macro elements"
      />
    </div>
  );
}
