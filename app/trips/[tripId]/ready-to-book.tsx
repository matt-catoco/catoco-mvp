"use client";

import type { ReactNode } from "react";
import { bookingLinkFor } from "@/lib/booking-link";
import { btnPrimary } from "@/lib/ui";
import { BookingRecordForm, type BookingDraft } from "./booking-record-form";

export type ReadyToBookProps = {
  tripId: string;
  elementId: string;
  optionValue: Record<string, unknown>;
  draft: BookingDraft;
  roster: { userId: string; displayName: string }[];
  showIncidentals: boolean;
  amountFromCard: number | null;
  /** the Issuing card block (Stripe Issuing display elements), when enabled */
  card?: ReactNode;
  /** copy-ready traveler details (loaded on demand, every view logged) */
  travelers?: ReactNode;
};

/**
 * Ready to Book (founder spec 2026-10-10): three steps on our side — open
 * the vendor, copy the card, copy the traveler details — then record the
 * booking. Vendor checkout steps are theirs. The link step says honestly how
 * much of the vendor's page we can pre-fill.
 */
export function ReadyToBook({ tripId, elementId, optionValue, draft, roster, showIncidentals, amountFromCard, card, travelers }: ReadyToBookProps) {
  const link = bookingLinkFor(optionValue);
  const step = "flex flex-col gap-1.5 border-t border-brand-line pt-3 first:border-0 first:pt-0";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand-line p-3 text-xs">
      <span className="font-medium text-black dark:text-zinc-50">Funded — ready to book</span>

      <div className={step}>
        <span className="font-medium">1. Open {link.providerLabel === "Added by hand" ? "the vendor" : link.providerLabel}</span>
        {link.url ? (
          <a href={link.url} target="_blank" rel="noopener noreferrer" className={`w-fit px-3 py-1.5 ${btnPrimary}`}>
            Open booking page ↗
          </a>
        ) : null}
        <span className="text-brand-muted">{link.coverageLabel}.</span>
      </div>

      <div className={step}>
        <span className="font-medium">2. Pay</span>
        {card ?? (
          <span className="text-brand-muted">
            Pay with your own card on the vendor&apos;s site, then enter what you paid below. (Catoco cards aren&apos;t switched on yet.)
          </span>
        )}
      </div>

      {travelers && (
        <div className={step}>
          <span className="font-medium">3. Traveler details</span>
          {travelers}
        </div>
      )}

      <div className={step}>
        <span className="font-medium">{travelers ? "4" : "3"}. Record the booking</span>
        <BookingRecordForm
          tripId={tripId}
          elementId={elementId}
          draft={draft}
          roster={roster}
          mode="purchase"
          amountFromCard={amountFromCard}
          showIncidentals={showIncidentals}
        />
      </div>
    </div>
  );
}
