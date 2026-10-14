// "5h", "45m", "3d" — compact time-left (moved from app/trips/[tripId]/page.tsx
// so Trip Home's tiles and the element page share one implementation).
export function timeLeft(ms: number): string {
  if (ms <= 0) return "now";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export const PHASE_DEADLINE = { submission: "Submissions close", voting: "Voting closes", funding: "Funding closes" } as const;
