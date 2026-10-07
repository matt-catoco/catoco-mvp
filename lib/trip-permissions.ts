// Trip permissions + default timing — plain data shared by server actions
// (trip creation) and the client fields component, so it lives outside any
// "use client" module.

export type TripPermissions = {
  allowParticipantElements: boolean;
  allowParticipantSubgroups: boolean;
  submissionDeadlineDays: number;
  fundingDeadlineDays: number;
};

/** Same defaults as the trips table columns (20261002000000 / 20261004000000). */
export const DEFAULT_TRIP_PERMISSIONS: TripPermissions = {
  allowParticipantElements: false,
  allowParticipantSubgroups: false,
  submissionDeadlineDays: 7,
  fundingDeadlineDays: 14,
};

/** Range check, mirroring the DB constraints (1–60 days). */
export function tripPermissionsError(v: TripPermissions): string | null {
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 60;
  if (!ok(v.submissionDeadlineDays)) return "Submission deadline must be 1–60 days.";
  if (!ok(v.fundingDeadlineDays)) return "Funding deadline must be 1–60 days.";
  return null;
}
