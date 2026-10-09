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
  /** Pre-fills a new element's voting deadline (days after added); null = no default. */
  votingDeadlineDays: number | null;
  /** Participants see each other's names (off: only their own + the organizer's). */
  viewAllParticipants: boolean;
  /** Element cards show a deadline clock inside this many hours. */
  deadlineAlertHours: 12 | 24 | 48;
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
  votingDeadlineDays: null,
  viewAllParticipants: true,
  deadlineAlertHours: 24,
};

/** Above this the settings UI asks "are you sure?" — a typo guard, not a limit. */
export const CUSHION_PERCENT_WARNING = 300;

/** Range check, mirroring the DB constraints (1–60 days). */
export function tripPermissionsError(v: TripPermissions): string | null {
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 60;
  if (!ok(v.submissionDeadlineDays)) return "Submission deadline must be 1–60 days.";
  if (!ok(v.fundingDeadlineDays)) return "Funding deadline must be 1–60 days.";
  if (!Number.isFinite(v.cushionValue) || v.cushionValue < 0) {
    return "Price cushion can't be negative.";
  }
  if (v.votingDeadlineDays !== null && (!Number.isInteger(v.votingDeadlineDays) || v.votingDeadlineDays < 1 || v.votingDeadlineDays > 90)) {
    return "Voting deadline default must be 1–90 days, or left empty.";
  }
  if (v.votingDeadlineDays !== null && v.votingDeadlineDays < v.submissionDeadlineDays) {
    return "The voting deadline default can't come before the submission deadline default.";
  }
  if (![12, 24, 48].includes(v.deadlineAlertHours)) return "Deadline alert must be 12, 24 or 48 hours.";
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
