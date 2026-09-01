import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ELEMENT_SYMBOLS,
  describeElementStatus,
  type ElementType,
} from "@/lib/trip-elements";
import { ElementGrid } from "@/components/trip-home/element-grid";
import { resolveAndNotify } from "./resolve-elements";

type ElementRow = {
  id: string;
  type: ElementType;
  label: string;
  state: "locked" | "open";
  locked_option_id: string | null;
  created_at: string;
};

/**
 * Trip Home — personalized per viewer (2026-09-01 redesign). RLS already
 * does the filtering: "Trip members can view elements" checks
 * is_element_member(id), so a plain select here naturally returns only what
 * the organizer (everything) or a regular participant (only what they're
 * scoped into) can see — no client-side filtering needed. Elements are now
 * multi-instance, so this is a feed of actual rows, not one tile per fixed
 * type.
 */
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

  // Ensure roster membership before reading anything — the "Trip members can
  // view" policies require a trip_participants row (or being the organizer)
  // to grant read access at all, so this has to run first, every visit.
  await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, organizer_id")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) {
    // Not a member and nothing to join into (trip doesn't exist).
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

  // Lazy auto-lock, shared with the drill-in page — either can be the first
  // page visited after a deadline passes.
  await resolveAndNotify(supabase, tripId, trip.organizer_id, trip.name);

  const { data: elements } = await supabase
    .from("trip_elements")
    .select("id, type, label, state, locked_option_id, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true })
    .returns<ElementRow[]>();

  const rows = elements ?? [];

  const openIds = rows.filter((e) => e.state === "open").map((e) => e.id);
  const lockedOptionIds = rows
    .map((e) => e.locked_option_id)
    .filter((id): id is string => !!id);

  const [{ data: openOptions }, { data: lockedOptions }] = await Promise.all([
    openIds.length
      ? supabase.from("element_options").select("id, element_id").in("element_id", openIds)
      : Promise.resolve({ data: [] as { id: string; element_id: string }[] }),
    lockedOptionIds.length
      ? supabase.from("element_options").select("id, value").in("id", lockedOptionIds)
      : Promise.resolve({ data: [] as { id: string; value: Record<string, unknown> }[] }),
  ]);

  const optionCountByElement = new Map<string, number>();
  for (const o of openOptions ?? []) {
    optionCountByElement.set(o.element_id, (optionCountByElement.get(o.element_id) ?? 0) + 1);
  }
  const lockedValueById = new Map(
    (lockedOptions ?? []).map((o) => [o.id, o.value as Record<string, unknown>]),
  );

  const tiles = rows.map((row, idx) => {
    const lockedValue = row.locked_option_id
      ? lockedValueById.get(row.locked_option_id) ?? null
      : null;
    const info = describeElementStatus({
      type: row.type,
      state: row.state,
      optionCount: optionCountByElement.get(row.id) ?? 0,
      lockedValue,
    });
    return {
      key: row.id,
      symbol: ELEMENT_SYMBOLS[row.type],
      label: row.label,
      num: String(idx + 1).padStart(2, "0"),
      state: info.state,
      statusLabel: info.statusLabel,
      detail: info.detail,
      href: `/trips/${tripId}/elements/${row.id}`,
    };
  });

  return (
    <div className="flex flex-1 flex-col items-center gap-8 px-6 py-16">
      <div className="flex w-full max-w-2xl flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {trip.name}
        </h1>
        <div className="flex gap-4 text-xs font-medium">
          <Link
            href={`/trips/${tripId}/add-element`}
            className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            + Add element
          </Link>
          <Link
            href={`/trips/${tripId}/participants`}
            className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Participants
          </Link>
        </div>
      </div>

      <div className="w-full max-w-2xl">
        {tiles.length === 0 ? (
          <p className="rounded-lg border border-black/[.1] p-6 text-center text-sm text-zinc-500 dark:border-white/[.14]">
            Nothing here yet — add the first element.
          </p>
        ) : (
          <ElementGrid tiles={tiles} />
        )}
      </div>
    </div>
  );
}
