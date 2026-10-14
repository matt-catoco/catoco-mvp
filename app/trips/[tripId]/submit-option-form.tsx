"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { keyFactsLine, optionThumbnail, optionTitle, priceWithBasis } from "@/components/option-summary";
import { applyTripContext, emptyValueFor, ELEMENT_SYMBOLS, type ElementType, type TripContext } from "@/lib/trip-elements";
import { btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";
import { submitOption } from "./actions";
import { VendorSearchModal } from "./vendor-search-modal";

// Destination has its own inline Mapbox-backed autocomplete already (see
// ElementValueFields' destination case) — no separate search overlay for it.
const VENDOR_SEARCH_TYPES: ElementType[] = ["travel", "accommodation", "experience", "dining"];

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-deep focus-visible:ring-offset-2";

/**
 * Propose an option: search (vendor APIs) or enter it manually. A picked
 * search result is reviewed first — read-only summary, an optional note for
 * the group, "Change" back to search, then "Add option" (founder redesign,
 * 2026-10-14; reverses the earlier submit-on-pick). Manual entry submits
 * directly, as before.
 */
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
  const [selectedResult, setSelectedResult] = useState<Record<string, unknown> | null>(null);
  const [value, setValue] = useState<Record<string, unknown>>(() =>
    applyTripContext(type, emptyValueFor(type), tripContext),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSearch = VENDOR_SEARCH_TYPES.includes(type);

  function submit(v: Record<string, unknown>, after: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await submitOption(elementId, v);
      if (res.error) {
        setError(res.error);
        return;
      }
      after();
      router.refresh();
    });
  }

  if (searchOpen) {
    return (
      <VendorSearchModal
        elementType={type}
        tripContext={tripContext}
        onClose={() => setSearchOpen(false)}
        onPicked={(picked) => {
          setError(null);
          setSelectedResult(picked);
        }}
      />
    );
  }

  // Review a picked search result before adding it.
  if (selectedResult) {
    const thumb = optionThumbnail(type, selectedResult);
    const facts = keyFactsLine(type, selectedResult);
    const price = priceWithBasis(selectedResult);
    const note = typeof selectedResult.note === "string" ? selectedResult.note : "";
    return (
      <section className="flex flex-col gap-3 rounded-[18px] border-[1.5px] border-brand-line bg-brand-surface p-4" aria-label="Add an option">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-foreground">Add an option</h2>
        <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-brand-teal-deep bg-brand-teal-wash p-2.5">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary vendor host
            <img src={thumb} alt="" className="h-[70px] w-[84px] flex-none rounded-[10px] bg-brand-line/50 object-cover" />
          ) : (
            <span
              aria-hidden
              className="grid h-[70px] w-[84px] flex-none place-items-center rounded-[10px] bg-brand-line/40 font-[family-name:var(--font-display)] text-base font-bold text-brand-muted"
            >
              {ELEMENT_SYMBOLS[type]}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-[family-name:var(--font-display)] text-[15px] font-bold text-foreground">
              {optionTitle(type, selectedResult)}
            </h3>
            <p className="line-clamp-2 text-[12.5px] text-brand-muted">
              {[facts, price ? `${price.amount}${price.basis ? ` ${price.basis}` : ""}` : null].filter(Boolean).join(" · ")}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedResult(null);
                setSearchOpen(true);
              }}
              className={`mt-1 rounded-sm text-[13px] font-semibold text-brand-accent underline underline-offset-[3px] ${focusRing}`}
            >
              Change
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>
            Note for the group <span className="font-normal text-brand-muted">(optional)</span>
          </span>
          <input
            className={`h-11 ${fieldClass}`}
            placeholder="Why this one?"
            value={note}
            onChange={(e) => setSelectedResult({ ...selectedResult, note: e.target.value })}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-brand-coral">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(selectedResult, () => setSelectedResult(null))}
          className={`h-11 w-full text-sm font-semibold ${btnPrimary} ${focusRing}`}
        >
          {pending ? "Adding…" : "Add option"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setSelectedResult(null)}
          className={`mx-auto rounded-sm text-[13px] font-semibold text-brand-muted underline underline-offset-[3px] hover:text-foreground ${focusRing}`}
        >
          Cancel
        </button>
      </section>
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

  return (
    <div className="rounded-lg border border-brand-line p-3">
      <ElementValueFields type={type} value={value} onChange={setValue} confirmedDates={tripContext?.confirmedDates} />
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            submit(value, () => {
              setValue(applyTripContext(type, emptyValueFor(type), tripContext));
              setOpen(false);
            })
          }
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
