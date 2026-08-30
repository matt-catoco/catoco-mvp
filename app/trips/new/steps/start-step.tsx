"use client";

export function StartStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Start a new trip
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          A trip is built from <strong>elements</strong> — dates, destination,
          budget, and more. For each one you choose:
        </p>
      </div>

      <ul className="flex flex-col gap-3 text-sm">
        <li className="rounded-lg border border-black/[.1] p-3 dark:border-white/[.14]">
          <span className="font-medium">Skip</span> — leave it for later.
        </li>
        <li className="rounded-lg border border-black/[.1] p-3 dark:border-white/[.14]">
          <span className="font-medium">Lock</span> — you set one fixed value now.
        </li>
        <li className="rounded-lg border border-black/[.1] p-3 dark:border-white/[.14]">
          <span className="font-medium">Open</span> — the group votes on it later.
          Seed a few options now, or leave it blank for people to propose.
        </li>
      </ul>

      <button
        type="button"
        onClick={onNext}
        className="self-start rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Start
      </button>
    </div>
  );
}
