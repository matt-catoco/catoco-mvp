"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { applyTripContext, emptyValueFor, type ElementType, type TripContext } from "@/lib/trip-elements";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import { submitOption } from "./actions";
import { VendorSearchModal } from "./vendor-search-modal";

// Destination has its own inline Mapbox-backed autocomplete already (see
// ElementValueFields' destination case) — no separate search overlay for it.
const VENDOR_SEARCH_TYPES: ElementType[] = ["travel", "accommodation", "experience", "dining"];

export function SubmitOptionForm({
  elementId,
  type,
  tripContext,
}: {
  elementId: string;
  type: ElementType;
  tripContext?: TripContext;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [value, setValue] = useState<Record<string, unknown>>(() =>
    applyTripContext(type, emptyValueFor(type), tripContext),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSearch = VENDOR_SEARCH_TYPES.includes(type);

  if (searchOpen) {
    return (
      <VendorSearchModal
        elementId={elementId}
        elementType={type}
        tripContext={tripContext}
        onClose={() => setSearchOpen(false)}
      />
    );
  }

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`self-start px-3 py-1.5 text-xs ${btnSecondary}`}
        >
          + Propose an option
        </button>
        {canSearch && (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className={`self-start px-3 py-1.5 text-xs ${btnPrimary}`}
          >
            Search options
          </button>
        )}
      </div>
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
      setValue(applyTripContext(type, emptyValueFor(type), tripContext));
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
