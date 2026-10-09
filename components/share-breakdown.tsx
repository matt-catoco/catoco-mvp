import { formatCurrency } from "@/lib/trip-elements";
import { platformFee } from "@/lib/platform-fee";

/**
 * What a participant pays: their share + Catoco's fee on top (one fee line,
 * even for a bundle — the share already sums every element). Stripe's
 * processing fee is Catoco's to absorb out of that fee, so it's never shown.
 * Falls back to the bare share for pre-fee requests (percent 0).
 */
export function ShareBreakdown({
  share,
  percent,
  currency,
}: {
  share: number;
  percent: number;
  currency: string;
}) {
  const fee = platformFee(share, percent);
  if (fee <= 0) {
    return <p className="text-sm font-medium text-black dark:text-zinc-50">{formatCurrency(share, currency)}</p>;
  }
  return (
    <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
      <dt className="text-brand-muted">Share</dt>
      <dd className="text-right tabular-nums">{formatCurrency(share, currency)}</dd>
      <dt className="text-brand-muted">Catoco fee ({percent}%)</dt>
      <dd className="text-right tabular-nums">{formatCurrency(fee, currency)}</dd>
      <dt className="font-medium text-black dark:text-zinc-50">Total</dt>
      <dd className="text-right text-sm font-medium tabular-nums text-black dark:text-zinc-50">
        {formatCurrency(share + fee, currency)}
      </dd>
    </dl>
  );
}
