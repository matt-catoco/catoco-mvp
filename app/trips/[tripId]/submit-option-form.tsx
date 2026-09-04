"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { emptyValueFor, type ElementType } from "@/lib/trip-elements";
import { submitOption } from "./actions";

export function SubmitOptionForm({
  elementId,
  type,
}: {
  elementId: string;
  type: ElementType;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Record<string, unknown>>(() => emptyValueFor(type));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-lg border border-black/[.12] px-3 py-1.5 text-xs font-medium hover:bg-black/[.03] dark:border-white/[.16] dark:hover:bg-white/[.05]"
      >
        + Propose an option
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitOption(elementId, value);
      if (res.error) {
        setError(res.error);
        return;
      }
      setValue(emptyValueFor(type));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-black/[.08] p-3 dark:border-white/[.1]">
      <ElementValueFields type={type} value={value} onChange={setValue} />
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Submitting…" : "Submit"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="text-xs text-zinc-500 underline hover:text-red-500 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
