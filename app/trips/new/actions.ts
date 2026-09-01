"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CreateTripResult = { error: string };

/**
 * Trip creation is now a bare shell (2026-09-01 redesign) — just a name and
 * optional icon. Every element, including Dates/Destination, is added
 * afterward from Trip Home. A plain insert against the existing
 * organizer-owns-all RLS policy on `trips` — no RPC needed now that there's
 * no multi-row element seeding to do transactionally (create_trip() RPC was
 * retired in the same migration that dropped the fixed element-slot model).
 */
export async function createTrip(
  name: string,
  icon: string | null,
): Promise<CreateTripResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the trip a name." };

  const { data, error } = await supabase
    .from("trips")
    .insert({ name: trimmed, icon, organizer_id: user.id })
    .select("id")
    .single();

  if (error) return { error: error.message };

  redirect(`/trips/${data.id}`);
}
