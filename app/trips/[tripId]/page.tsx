import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ALL_TYPES,
  ELEMENT_LABELS,
  ELEMENT_SYMBOLS,
  describeElementTile,
  type ElementType,
  type ParticipantsValue,
} from "@/lib/trip-elements";
import { ElementGrid } from "@/components/trip-home/element-grid";
import { resolveAndNotify } from "./resolve-elements";

type ElementRow = {
  id: string;
  type: ElementType;
  state: "locked" | "open";
  locked_option_id: string | null;
  invites_sent: boolean;
};

/**
 * Trip Home — the tile-grid dashboard (flow #3 batch 3). One tile per
 * element type, tap to drill into /trips/[tripId]/elements/[elementId].
 * Replaces the previous flat list that mixed voting/submission UI inline;
 * that UI moved to the drill-in route, unchanged.
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

  // Ensure membership before reading anything — the "Trip members can view"
  // policies require an element_participants row (or being the organizer) to
  // grant read access at all, so this has to run first, every visit. It's a
  // no-op for the organizer and idempotent for an already-joined participant.
  await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, organizer_id")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) {
    // Not a member and nothing to join into (trip doesn't exist, or has no
    // participants element yet) — same generic landing as before.
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

  // Lazy auto-lock: resolve anything past its voting_deadline before reading
  // element state below, so a just-locked element renders as locked, not
  // stale-open. Notification is best-effort — shared with the drill-in page,
  // since either can be the first page visited after a deadline passes.
  await resolveAndNotify(supabase, tripId, trip.organizer_id, trip.name);

  const { data: elements } = await supabase
    .from("trip_elements")
    .select("id, type, state, locked_option_id, invites_sent")
    .eq("trip_id", tripId)
    .returns<ElementRow[]>();

  const rows = elements ?? [];
  const rowsByType = new Map(rows.map((e) => [e.type, e]));

  const openIds = rows.filter((e) => e.state === "open").map((e) => e.id);
  const lockedOptionIds = rows
    .map((e) => e.locked_option_id)
    .filter((id): id is string => !!id);

  const [{ data: openOptions }, { data: lockedOptions }, participantsOptedIn] =
    await Promise.all([
      openIds.length
        ? supabase.from("element_options").select("id, element_id").in("element_id", openIds)
        : Promise.resolve({ data: [] as { id: string; element_id: string }[] }),
      lockedOptionIds.length
        ? supabase
            .from("element_options")
            .select("id, value")
            .in("id", lockedOptionIds)
        : Promise.resolve({ data: [] as { id: string; value: Record<string, unknown> }[] }),
      (async () => {
        const participantsElement = rowsByType.get("participants");
        if (!participantsElement) return 0;
        const { count } = await supabase
          .from("element_participants")
          .select("*", { count: "exact", head: true })
          .eq("element_id", participantsElement.id)
          .eq("opted_in", true);
        return count ?? 0;
      })(),
    ]);

  const optionCountByElement = new Map<string, number>();
  for (const o of openOptions ?? []) {
    optionCountByElement.set(o.element_id, (optionCountByElement.get(o.element_id) ?? 0) + 1);
  }
  const lockedValueById = new Map(
    (lockedOptions ?? []).map((o) => [o.id, o.value as Record<string, unknown>]),
  );

  const tiles = ALL_TYPES.map((type, idx) => {
    const row = rowsByType.get(type);
    const lockedValue = row?.locked_option_id
      ? lockedValueById.get(row.locked_option_id) ?? null
      : null;

    const info = describeElementTile({
      type,
      row: row
        ? {
            state: row.state,
            optionCount: optionCountByElement.get(row.id) ?? 0,
            lockedValue,
            participants:
              type === "participants"
                ? {
                    min: (lockedValue as ParticipantsValue | null)?.min ?? null,
                    max: (lockedValue as ParticipantsValue | null)?.max ?? null,
                    invitesSent: row.invites_sent,
                    optedInCount: participantsOptedIn,
                  }
                : undefined,
          }
        : null,
    });

    return {
      key: type,
      symbol: ELEMENT_SYMBOLS[type],
      label: ELEMENT_LABELS[type],
      num: String(idx + 1).padStart(2, "0"),
      state: info.state,
      statusLabel: info.statusLabel,
      detail: info.detail,
      href: row ? `/trips/${tripId}/elements/${row.id}` : undefined,
    };
  });

  return (
    <div className="flex flex-1 flex-col items-center gap-8 px-6 py-16">
      <div className="w-full max-w-2xl text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {trip.name}
        </h1>
      </div>

      <div className="w-full max-w-2xl">
        <ElementGrid tiles={tiles} />
      </div>
    </div>
  );
}
