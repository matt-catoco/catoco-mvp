import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteLink } from "../invite-link";

type RosterRow = { user_id: string; display_name: string | null; is_organizer: boolean };

/**
 * Participants isn't an element anymore (2026-09-01 redesign) — it's a
 * permanent, separate surface: the trip's roster plus the invite link,
 * decoupled from anything with a locked/open/vote lifecycle. Invite
 * generation stays organizer-only (no ask to open that up); the roster
 * itself is visible to any member.
 */
export default async function ParticipantsPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}/participants`)}`,
    );
  }

  await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, organizer_id, invites_sent")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) redirect(`/trips/${tripId}`);

  const { data: rosterData } = await supabase.rpc("get_trip_roster", { p_trip_id: tripId });
  const roster = ((rosterData ?? []) as RosterRow[]).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name?.trim() || (r.is_organizer ? "Organizer" : "Member"),
    isOrganizer: r.is_organizer,
  }));

  const isOrganizer = trip.organizer_id === user.id;

  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <Link
        href={`/trips/${tripId}`}
        className="text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-zinc-50"
      >
        ← {trip.name}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Participants
      </h1>

      <ul className="mt-6 flex flex-col gap-2">
        {roster.map((r) => (
          <li
            key={r.userId}
            className="flex items-center justify-between rounded-lg border border-black/[.1] px-3 py-2 text-sm dark:border-white/[.14]"
          >
            <span className="text-black dark:text-zinc-50">
              {r.displayName}
              {r.userId === user.id && " (you)"}
            </span>
            {r.isOrganizer && (
              <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
                Organizer
              </span>
            )}
          </li>
        ))}
      </ul>

      {isOrganizer && (
        <div className="mt-8 rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Invite people</h2>
          <InviteLink tripId={tripId} initialInvitesSent={trip.invites_sent} />
        </div>
      )}
    </div>
  );
}
