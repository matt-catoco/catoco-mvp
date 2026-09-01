import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteLink } from "../invite-link";
import { ParticipantRoleSelect } from "../participant-role-select";
import { CapacityForm } from "../capacity-form";

type RosterRow = {
  user_id: string;
  display_name: string | null;
  is_organizer: boolean;
  role: "organizer" | "participant" | "co_organizer";
  joined_at: string | null;
};

/**
 * Participants isn't an element — it's a permanent, separate surface: the
 * trip's roster, roles, capacity, and the invite link, decoupled from
 * anything with a locked/open/vote lifecycle. Invite generation stays
 * organizer/co-organizer-only; the roster itself is visible to any member.
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
    .select("id, name, organizer_id, invites_sent, min_participants, max_participants")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) redirect(`/trips/${tripId}`);

  const [{ data: rosterData }, { data: canManage }] = await Promise.all([
    supabase.rpc("get_trip_roster", { p_trip_id: tripId }),
    supabase.rpc("is_trip_organizer", { p_trip_id: tripId }),
  ]);
  const roster = ((rosterData ?? []) as RosterRow[]).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name?.trim() || (r.is_organizer ? "Organizer" : "Member"),
    isOrganizer: r.is_organizer,
    role: r.role,
    joinedAt: r.joined_at,
  }));

  const max = trip.max_participants;
  // First-come-first-served by join order (roster is already ordered by
  // joined_at, organizer first with a null joined_at). Informational only —
  // nobody's blocked from the roster itself, this just shows who'd have
  // "the spot" today if capacity matters to how you're using it.
  const nonOrganizerIds = roster.filter((r) => !r.isOrganizer).map((r) => r.userId);
  const withinCapacity = new Set(
    max != null ? nonOrganizerIds.slice(0, max) : nonOrganizerIds,
  );

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
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {nonOrganizerIds.length} joined
        {trip.min_participants != null && ` · needs ${trip.min_participants}`}
        {max != null && ` · caps at ${max}`}
      </p>

      <ul className="mt-6 flex flex-col gap-2">
        {roster.map((r) => {
          const overCapacity = !r.isOrganizer && max != null && !withinCapacity.has(r.userId);
          return (
            <li
              key={r.userId}
              className="flex items-center justify-between rounded-lg border border-black/[.1] px-3 py-2 text-sm dark:border-white/[.14]"
            >
              <span className="text-black dark:text-zinc-50">
                {r.displayName}
                {r.userId === user.id && " (you)"}
                {overCapacity && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    over capacity
                  </span>
                )}
              </span>
              {r.isOrganizer ? (
                <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
                  Organizer
                </span>
              ) : canManage ? (
                <ParticipantRoleSelect tripId={tripId} userId={r.userId} role={r.role as "participant" | "co_organizer"} />
              ) : (
                <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
                  {r.role === "co_organizer" ? "Co-Organizer" : "Participant"}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && (
        <>
          <div className="mt-8 rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Group size</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Doesn&apos;t block anyone from joining via the invite link — first to join gets
              the spot within max, shown above.
            </p>
            <div className="mt-3">
              <CapacityForm
                tripId={tripId}
                initialMin={trip.min_participants}
                initialMax={trip.max_participants}
              />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Invite people</h2>
            <InviteLink tripId={tripId} initialInvitesSent={trip.invites_sent} />
          </div>
        </>
      )}
    </div>
  );
}
