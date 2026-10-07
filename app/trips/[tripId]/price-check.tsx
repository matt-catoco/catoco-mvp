"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/trip-elements";
import { btnSecondary, fieldClass } from "@/lib/ui";
import { recheckElementPrice, updateElementPrice } from "./price-actions";

export type PriceInfo = {
  unitPrice: number | null;
  /** "/person", "/night", or "" */
  basisSuffix: string;
  /** Duffel / LiteAPI options can be re-quoted automatically. */
  vendorLabel: string | null;
  /** e.g. "10%" or "€25 per person" */
  cushionLabel: string;
  previousShare: number | null;
  priceChangedAt: string | null;
};

const OUTCOME_COPY: Record<string, string> = {
  unchanged: "Price checked — no change.",
  within_cushion: "Price updated. It's within everyone's cushion, so their authorizations still stand at the new share.",
  over_cushion:
    "Price updated beyond the cushion — authorizations were canceled and everyone needs to authorize again at the new share (or drop this element).",
};

/**
 * Price section on a locked element's funding (flow #4 price cushion).
 * Everyone sees that the price isn't guaranteed and any change; the
 * organizer / purchaser can recheck it with the vendor or set it by hand
 * while funding is open. reprice_locked_element() decides the outcome.
 */
export function PriceCheck({
  tripId,
  elementId,
  currency,
  share,
  canAct,
  editable,
  info,
}: {
  tripId: string;
  elementId: string;
  currency: string;
  share: number;
  canAct: boolean;
  /** Funding still open and uncharged. */
  editable: boolean;
  info: PriceInfo;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [manual, setManual] = useState(info.unitPrice != null ? String(info.unitPrice) : "");

  function run(fn: () => Promise<{ error?: string; outcome?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) return setMessage({ ok: false, text: res.error });
      setMessage({ ok: true, text: OUTCOME_COPY[res.outcome ?? "unchanged"] ?? "Price updated." });
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-brand-line pt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-black dark:text-zinc-50">Price</span>
        {info.unitPrice != null && (
          <span className="text-brand-muted">
            {formatCurrency(info.unitPrice, currency)}
            {info.basisSuffix}
          </span>
        )}
      </div>
      {info.previousShare != null && info.priceChangedAt && (
        <p className="mt-1 text-xs text-black dark:text-zinc-50">
          Share changed {formatCurrency(info.previousShare, currency)} → {formatCurrency(share, currency)} on{" "}
          {new Date(info.priceChangedAt).toLocaleDateString()}.
        </p>
      )}
      <p className="mt-1 text-[11px] text-brand-muted">
        Not guaranteed until booked — prices can move before the group pays. Authorizations cover up to a{" "}
        {info.cushionLabel} cushion; anything beyond that needs everyone to authorize again.
      </p>

      {canAct && editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {info.vendorLabel && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => recheckElementPrice(tripId, elementId))}
              className={`h-8 px-3 text-xs ${btnSecondary}`}
            >
              {pending ? "Checking…" : `Recheck with ${info.vendorLabel}`}
            </button>
          )}
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              className={`h-8 w-28 ${fieldClass}`}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              aria-label="New price"
            />
            <button
              type="button"
              disabled={pending || manual.trim() === "" || Number(manual) === info.unitPrice}
              onClick={() => run(() => updateElementPrice(tripId, elementId, Number(manual)))}
              className={`h-8 px-3 text-xs ${btnSecondary}`}
            >
              Update price
            </button>
          </span>
        </div>
      )}
      {message && (
        <p className={`mt-1.5 text-xs ${message.ok ? "text-brand-muted" : "text-red-500"}`}>{message.text}</p>
      )}
    </div>
  );
}

