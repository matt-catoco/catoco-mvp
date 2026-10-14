/**
 * Withdrawals on a group-split pool (founder, 2026-10-14): Commit pauses
 * until the organizer recalculates the shares or someone takes the spot.
 * With no organizer action after this many hours — or straight away when
 * the withdrawal lands within this many hours of the funding deadline —
 * the shares are recalculated automatically. The funding deadline itself
 * never moves. Server side: auto_recalculate_funding_shares (hourly cron)
 * and cancel_funding_mandate.
 */
export const AUTO_RECALC_HOURS = 24;

/** When a pending withdrawal will be recalculated automatically (the hourly job runs it at the latest an hour after). */
export function autoRecalcAt(firstWithdrawnAt: string | null, deadline: string | null): string | null {
  if (!firstWithdrawnAt) return null;
  const hours = AUTO_RECALC_HOURS * 3600 * 1000;
  const byWait = new Date(firstWithdrawnAt).getTime() + hours;
  const byDeadline = deadline ? new Date(deadline).getTime() - hours : Infinity;
  return new Date(Math.min(byWait, byDeadline)).toISOString();
}
