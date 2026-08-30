"use client";

export function WizardNav({
  onBack,
  onNext,
  nextDisabled = false,
  nextLabel = "Next",
  backLabel = "Back",
}: {
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  backLabel?: string;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-black/[.12] px-4 py-2 text-sm font-medium hover:bg-black/[.03] dark:border-white/[.16] dark:hover:bg-white/[.05]"
      >
        {backLabel}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {nextLabel}
      </button>
    </div>
  );
}
