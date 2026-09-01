import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AddElementForm } from "../add-element-form";

type RosterRow = { user_id: string; display_name: string | null; is_organizer: boolean };

export default async function AddElementPage({
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
      `/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}/add-element`)}`,
    );
  }

  await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, organizer_id")
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
  }));

  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Add an element
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">to {trip.name}</p>

      <div className="mt-8">
        <AddElementForm
          tripId={tripId}
          currentUserId={user.id}
          isOrganizer={Boolean(canManage)}
          roster={roster}
        />
      </div>
    </div>
  );
}
