"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { emptyValueFor, type ElementType } from "@/lib/trip-elements";
import { btnPrimary, btnSecondary } from "@/lib/ui";
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
        className={`self-start px-3 py-1.5 text-xs ${btnSecondary}`}
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
    <div className="rounded-lg border border-brand-line p-3">
      <ElementValueFields type={type} value={value} onChange={setValue} />
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={`px-3 py-1.5 text-xs ${btnPrimary}`}
        >
          {pending ? "Submitting…" : "Submit"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className={`px-3 py-1.5 text-xs ${btnSecondary}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
