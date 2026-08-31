import type { ElementType } from "@/lib/trip-elements";

export type ElementChoice = "skip" | "locked" | "open";

export type OptionDraft = {
  // client-only key for list rendering
  key: string;
  value: Record<string, unknown>;
};

export type ElementDraft = {
  choice: ElementChoice;
  // only meaningful when choice === "open"; both editable any time up to lock
  optionsDeadline: string;
  votingDeadline: string;
  // locked  -> exactly one entry (the fixed value)
  // open    -> zero or more seeded candidates
  options: OptionDraft[];
};

export type WizardDraft = {
  name: string;
  // `preset:<id>` or a storage object path, or null
  icon: string | null;
  elements: Record<ElementType, ElementDraft>;
};

export const WIZARD_STEPS = [
  "start",
  "name",
  "macro",
  "micro",
  "review",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
