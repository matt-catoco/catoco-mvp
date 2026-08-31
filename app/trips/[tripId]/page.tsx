import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeParticipantsStatus,
  PARTICIPANTS_STATUS_LABELS,
  type ParticipantsValue,
} from "@/lib/trip-elements";
import { InviteLink } from "./invite-link";

export default async function TripLandingPage({
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
      `/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}`)}`,
    );
  }

  // trips RLS is organizer-only today, so a row only comes back for the
  // organizer's own trip. No row = this visitor is a participant, not the
  // organizer — record their opt-in via the security-definer RPC (it looks
  // up the trip/element itself, so no broader read access is needed here).
  const { data: trip } = await supabase
    .from("trips")
    .select("id, name")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) {
    await supabase.rpc("join_trip", { p_trip_id: tripId });

    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            You&apos;re in
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Trip <code className="font-mono text-[0.9em]">{tripId}</code>
          </p>
          <p className="mt-1 text-xs text-zinc-500">Trip details coming soon.</p>
        </div>
      </div>
    );
  }

  // Organizer view — surface the participants range + invite link if that
  // element is locked. Anything else (open/skipped) stays out of scope here.
  const { data: participantsElement } = await supabase
    .from("trip_elements")
    .select("id, state, invites_sent")
    .eq("trip_id", tripId)
    .eq("type", "participants")
    .maybeSingle();

  let participantsSection: ReactNode = null;

  if (participantsElement?.state === "locked") {
    const [{ data: option }, { count }] = await Promise.all([
      supabase
        .from("element_options")
        .select("value")
        .eq("element_id", participantsElement.id)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("element_participants")
        .select("*", { count: "exact", head: true })
        .eq("element_id", participantsElement.id)
        .eq("opted_in", true),
    ]);

    const value = (option?.value ?? {}) as ParticipantsValue;
    const optedInCount = count ?? 0;
    const status = computeParticipantsStatus({
      min: value.min ?? null,
      max: value.max ?? null,
      invitesSent: participantsElement.invites_sent,
      optedInCount,
    });

    participantsSection = (
      <div className="mt-6 w-full max-w-md rounded-xl border border-black/[.1] p-4 text-left dark:border-white/[.14]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            Participants
          </h2>
          <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
            {PARTICIPANTS_STATUS_LABELS[status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {optedInCount} joined
          {value.min != null && ` · needs ${value.min}`}
          {value.max != null && ` · caps at ${value.max}`}
        </p>
        <InviteLink
          tripId={tripId}
          initialInvitesSent={participantsElement.invites_sent}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-24 text-center">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {trip.name}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">Trip details coming soon.</p>
      </div>
      {participantsSection}
    </div>
  );
}
