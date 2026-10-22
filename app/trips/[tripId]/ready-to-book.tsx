"use client";

import type { ReactNode } from "react";
import { bookingLinkFor } from "@/lib/booking-link";
import { bookingRouteFor } from "@/lib/booking-route";
import type { CollectionMode } from "@/lib/collection-modes";
import { fmt } from "@/lib/i18n/config";
import { useT } from "@/lib/i18n/client";
import { isAutomaticBooking } from "@/lib/booking-capability";
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
  /** how the group paid (pledge-only: the organizer pays the vendor with the group's money) */
  collectionMode?: CollectionMode;
  /** pledge-only: the gap the organizer chose to cover, formatted */
  shortfall?: string | null;
};

/**
 * Ready to Book (founder spec 2026-10-10): three steps on our side — open
 * the vendor, copy the card, copy the traveler details — then record the
 * booking. Vendor checkout steps are theirs. The link step says honestly how
 * much of the vendor's page we can pre-fill.
 */
export function ReadyToBook({
  tripId,
  elementId,
  optionValue,
  draft,
  roster,
  showIncidentals,
  amountFromCard,
  card,
  travelers,
  collectionMode,
  shortfall,
}: ReadyToBookProps) {
  const t = useT();
  const link = bookingLinkFor(optionValue);
  // Launch scope: affiliate_link and proposed_link only. api_booking (Prompt
  // 5) is intentionally unbuilt, so API-only options show "no link".
  const route = bookingRouteFor(optionValue);
  // Gated off (AUTOMATIC_BOOKING_ENABLED) until a vendor booking integration exists.
  if (isAutomaticBooking(optionValue)) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-brand-line p-3 text-xs">
        <span className="font-medium text-black dark:text-zinc-50">✓ Funded. We&apos;re booking it for you</span>
        <span className="text-brand-muted">The booking is made automatically. The details appear here once it&apos;s confirmed.</span>
      </div>
    );
  }
  const step = "flex flex-col gap-1.5 border-t border-brand-line pt-3 first:border-0 first:pt-0";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand-line p-3 text-xs">
      <span className="font-medium text-black dark:text-zinc-50">Funded · ready to book</span>

      <div className={step}>
        <span className="font-medium">1. Open the vendor</span>
        {link.url && route ? (
          // Through /out: logs the click and adds our sub-ID to partner links.
          <a href={`/out/${elementId}`} target="_blank" rel="noopener noreferrer" className={`w-fit px-3 py-1.5 ${btnPrimary}`}>
            {t.booking.openVendor}
          </a>
        ) : null}
        <span className="text-brand-muted">
          {route === "affiliate_link" ? t.booking.routeAffiliate : route === "proposed_link" ? t.booking.routeProposed : t.booking.routeNone}{" "}
          {link.coverageLabel}.
        </span>
      </div>

      <div className={step}>
        <span className="font-medium">2. Pay</span>
        {shortfall && <span className="font-medium text-amber-700 dark:text-amber-400">{fmt(t.booking.shortfall, { gap: shortfall })}</span>}
        {collectionMode === "peer_pledge" ? (
          <span className="text-brand-muted">{t.booking.payPledge}</span>
        ) : card ?? (
          <span className="text-brand-muted">
            Pay with your own card on their site, then enter what you paid below. (Catoco cards aren&apos;t switched on yet.)
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
