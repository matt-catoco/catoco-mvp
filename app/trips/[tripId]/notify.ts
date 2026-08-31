import "server-only";
import { sendEmail } from "@/lib/email";
import { ELEMENT_LABELS, type ElementType } from "@/lib/trip-elements";

/**
 * Fired from resolve_due_elements()'s results — each row it returns is a
 * one-time notification (the tie_notified/empty_notified flags in the DB
 * make repeat calls a no-op), so this never double-sends across page visits.
 * Best-effort: caller doesn't fail the page render if this fails.
 */
export async function notifyOrganizer({
  reason,
  elementType,
  tripId,
  tripName,
  organizerEmail,
  origin,
}: {
  reason: "tie" | "empty";
  elementType: ElementType;
  tripId: string;
  tripName: string;
  organizerEmail: string;
  origin: string;
}): Promise<void> {
  const label = ELEMENT_LABELS[elementType];
  const url = `${origin}/trips/${tripId}`;

  const subject =
    reason === "tie"
      ? `${label} needs a tie-breaker — ${tripName}`
      : `${label} has no options yet — ${tripName}`;

  const html =
    reason === "tie"
      ? `<p>Voting closed for <strong>${label}</strong> on <strong>${tripName}</strong>, but the top choices tied — the group didn't converge on one answer automatically.</p>
         <p>Take a look and pick one: <a href="${url}">${url}</a></p>`
      : `<p>The deadline for submitting options passed for <strong>${label}</strong> on <strong>${tripName}</strong>, and nobody proposed any — so it's still sitting open with nothing to vote on.</p>
         <p>Take a look: <a href="${url}">${url}</a></p>`;

  await sendEmail({ to: organizerEmail, subject, html });
}
