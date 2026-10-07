"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toUserFacingError } from "@/lib/action-errors";
import type { IconAttribution } from "@/lib/trip-icons";
import { DEFAULT_TRIP_PERMISSIONS, type TripPermissions } from "@/lib/trip-permissions";

export type CreateTripResult = { error: string };

/**
 * Trip creation is now a bare shell (2026-09-01 redesign) — just a name and
 * optional icon. Every element, including Dates/Destination, is added
 * afterward from Trip Home. A plain insert against the existing
 * organizer-owns-all RLS policy on `trips` — no RPC needed now that there's
 * no multi-row element seeding to do transactionally (create_trip() RPC was
 * retired in the same migration that dropped the fixed element-slot model).
 * The trip's permissions + default timing can be set here too (same fields
 * as Trip settings, which can change them later); the columns' CHECK
 * constraints are the final range guard.
 */
export async function createTrip(
  name: string,
  icon: string | null,
  iconAttribution: IconAttribution | null = null,
  permissions: TripPermissions = DEFAULT_TRIP_PERMISSIONS,
): Promise<CreateTripResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the trip a name." };

  const days = (n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 60 ? (n as number) : null);
  const submissionDays = days(permissions.submissionDeadlineDays);
  const fundingDays = days(permissions.fundingDeadlineDays);
  if (submissionDays === null) return { error: "Submission deadline must be 1–60 days." };
  if (fundingDays === null) return { error: "Funding deadline must be 1–60 days." };
  const allowElements = permissions.allowParticipantElements === true;

  const { data, error } = await supabase
    .from("trips")
    .insert({
      name: trimmed,
      icon,
      icon_attribution: iconAttribution,
      organizer_id: user.id,
      allow_participant_elements: allowElements,
      // Same rule as update_trip_permissions(): subgroups need elements on.
      allow_participant_subgroups: allowElements && permissions.allowParticipantSubgroups === true,
      submission_deadline_days: submissionDays,
      funding_deadline_days: fundingDays,
      allow_over_max: permissions.allowOverMax === true,
      allow_participant_invites: permissions.allowParticipantInvites === true,
      price_cushion_kind: permissions.cushionKind === "amount" ? "amount" : "percent",
      price_cushion_value: Number.isFinite(permissions.cushionValue) ? permissions.cushionValue : 10,
    })
    .select("id")
    .single();

  if (error) return { error: toUserFacingError(error) };

  redirect(`/trips/${data.id}`);
}
