import { formatCurrency } from "@/lib/trip-elements";

// Trip permissions + default timing — plain data shared by server actions
// (trip creation) and the client fields component, so it lives outside any
// "use client" module.

export type TripPermissions = {
  allowParticipantElements: boolean;
  allowParticipantSubgroups: boolean;
  submissionDeadlineDays: number;
  fundingDeadlineDays: number;
  /** Newcomers can join past the trip's max (elements with limited spots go to the first to commit). */
  allowOverMax: boolean;
  /** Participants see the invite link too. */
  allowParticipantInvites: boolean;
  /** Price cushion: a percent of each share, or a fixed amount per person. */
  cushionKind: "percent" | "amount";
  cushionValue: number;
  /** Hours a participant gets to fix a failed card hold before the group's holds are released. */
  retryHours: number;
};

/** Same defaults as the trips table columns (20261002000000 / 20261004000000). */
export const DEFAULT_TRIP_PERMISSIONS: TripPermissions = {
  allowParticipantElements: false,
  allowParticipantSubgroups: false,
  submissionDeadlineDays: 7,
  fundingDeadlineDays: 14,
  allowOverMax: false,
  allowParticipantInvites: false,
  cushionKind: "percent",
  cushionValue: 10,
  retryHours: 24,
};

/** Range check, mirroring the DB constraints (1–60 days). */
export function tripPermissionsError(v: TripPermissions): string | null {
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 60;
  if (!ok(v.submissionDeadlineDays)) return "Submission deadline must be 1–60 days.";
  if (!ok(v.fundingDeadlineDays)) return "Funding deadline must be 1–60 days.";
  if (!Number.isFinite(v.cushionValue) || v.cushionValue < 0 || (v.cushionKind === "percent" && v.cushionValue > 100)) {
    return "Price cushion must be 0–100% or a non-negative amount.";
  }
  if (!Number.isInteger(v.retryHours) || v.retryHours < 1 || v.retryHours > 144) {
    return "Payment retry window must be 1–144 hours.";
  }
  return null;
}

/** "10%" or "€25 per person" — a price cushion for display. */
export function cushionLabel(kind: string | null | undefined, value: number | null | undefined, currency: string): string {
  const v = Number(value ?? 0);
  return kind === "amount" ? `${formatCurrency(v, currency)} per person` : `${v}%`;
}
