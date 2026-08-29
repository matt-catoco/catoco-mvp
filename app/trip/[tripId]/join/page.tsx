import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Invite-link entry point. No UI — just decides where the visitor goes.
 *
 * - Already signed in (existing account clicking an invite): straight to the
 *   trip. Do NOT touch `invited_via_trip_id`; it's set once, at account
 *   creation, never on re-invite.
 * - Signed out: send to sign-in, carrying the trip so the magic-link flow
 *   lands them back here's destination afterwards.
 */
export default async function JoinTripPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(`/trips/${tripId}`);
  }

  redirect(
    `/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}`)}`,
  );
}
