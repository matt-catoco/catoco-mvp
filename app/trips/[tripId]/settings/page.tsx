import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TripSettingsForm } from "../trip-settings-form";
import type { IconAttribution } from "@/lib/trip-icons";

/**
 * Trip Settings — rename, icon change (organizer/co-organizer, via
 * update_trip()), and, for the actual organizer only, delete. Mirrors the
 * Participants page's structure (fetch trip + canManage, redirect if not a
 * member/doesn't exist) — this is its sibling under the same "permanent,
 * separate surface" umbrella, not an element with a lifecycle.
 */
export default async function TripSettingsPage({
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
    redirect(`/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}/settings`)}`);
  }

  await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, icon, icon_attribution, organizer_id")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) redirect(`/trips/${tripId}`);

  const { data: canManage } = await supabase.rpc("is_trip_organizer", { p_trip_id: tripId });
  if (!canManage) redirect(`/trips/${tripId}`);

  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <Link
        href={`/trips/${tripId}`}
        className="text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-zinc-50"
      >
        ← {trip.name}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Trip settings
      </h1>

      <div className="mt-8">
        <TripSettingsForm
          tripId={tripId}
          currentUserId={user.id}
          isOrganizer={trip.organizer_id === user.id}
          initialName={trip.name}
          initialIcon={trip.icon}
          initialIconAttribution={trip.icon_attribution as IconAttribution | null}
        />
      </div>
    </div>
  );
}
