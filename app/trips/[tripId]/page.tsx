import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ELEMENT_SYMBOLS,
  describeElementStatus,
  formatDate,
  type ElementType,
  type FundingStatus,
} from "@/lib/trip-elements";
import { getElementSchedule } from "@/lib/element-schedule";
import { TripOverview } from "@/components/trip-home/trip-overview";
import type { OverviewElement } from "@/components/trip-home/types";
import { resolveAndNotify } from "./resolve-elements";
import { notifyInvited } from "@/lib/notifications";
import { AddElementModal } from "./add-element-modal";
import { getTripContext } from "./trip-context";

type RosterRow = { user_id: string; display_name: string | null; is_organizer: boolean };

type ElementRow = {
  id: string;
  type: ElementType;
  label: string;
  state: "locked" | "open";
  locked_option_id: string | null;
  locked_via: "organizer" | "vote" | null;
  options_deadline: string | null;
  booked_at: string | null;
  created_at: string;
  metadata: Record<string, string> | null;
};

type FundingRow = {
  status: FundingStatus;
  required_amount: number;
  actual_amount_paid: number | null;
  funding_request_elements: { element_id: string }[];
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
  // The return signals whether this was a genuinely new join (vs. an
  // existing member just revisiting) — that's the real "invited" moment.
  const { data: justJoined } = await supabase.rpc("join_trip", { p_trip_id: tripId });

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

  if (justJoined && user.email) {
    const { data: rosterData } = await supabase.rpc("get_trip_roster", { p_trip_id: tripId });
    const organizer = ((rosterData ?? []) as RosterRow[]).find((r) => r.is_organizer);
    const h = await headers();
    const host = h.get("host");
    const proto = process.env.NODE_ENV === "development" ? "http" : "https";
    const origin = host ? `${proto}://${host}` : "https://catoco.co";
    await notifyInvited({
      supabase,
      tripId,
      tripName: trip.name,
      organizerName: organizer?.display_name?.trim() || "Your trip organizer",
      userId: user.id,
      userEmail: user.email,
      origin,
    });
  }

  const [{ data: elements }, { data: rosterData }, { data: canManage }, tripContext] =
    await Promise.all([
      supabase
        .from("trip_elements")
        .select(
          "id, type, label, state, locked_option_id, locked_via, options_deadline, booked_at, created_at, metadata",
        )
        .eq("trip_id", tripId)
        .order("created_at", { ascending: true })
        .returns<ElementRow[]>(),
      supabase.rpc("get_trip_roster", { p_trip_id: tripId }),
      supabase.rpc("is_trip_organizer", { p_trip_id: tripId }),
      // §7: Trip Home's header shows a destination/dates line even when
      // nothing was ever locked as an explicit Destination/Dates element —
      // falls back to a locked Accommodations option's own location/dates
      // (a hotel-only-split trip). See getTripContext's own comment.
      getTripContext(supabase, tripId, { fallbackToLockedAccommodation: true }),
    ]);
  const addElementRoster = ((rosterData ?? []) as RosterRow[]).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name?.trim() || (r.is_organizer ? "Organizer" : "Member"),
    isOrganizer: r.is_organizer,
  }));

  const rows = elements ?? [];

  const openIds = rows.filter((e) => e.state === "open").map((e) => e.id);
  const lockedOptionIds = rows
    .map((e) => e.locked_option_id)
    .filter((id): id is string => !!id);

  const [{ data: openOptions }, { data: lockedOptions }, { data: fundingRows }] =
    await Promise.all([
      openIds.length
        ? supabase.from("element_options").select("id, element_id").in("element_id", openIds)
        : Promise.resolve({ data: [] as { id: string; element_id: string }[] }),
      lockedOptionIds.length
        ? supabase.from("element_options").select("id, value").in("id", lockedOptionIds)
        : Promise.resolve({ data: [] as { id: string; value: Record<string, unknown> }[] }),
      // Active (non-superseded) funding_requests for this trip's elements —
      // required/actual for the rollup, status for each tile's Funded/Booked
      // treatment. RLS (is_funding_request_member) already scopes this to
      // what the viewer can see, same as everything else on this page.
      supabase
        .from("funding_requests")
        .select("status, required_amount, actual_amount_paid, funding_request_elements(element_id)")
        .eq("trip_id", tripId)
        .neq("status", "superseded")
        .returns<FundingRow[]>(),
    ]);

  const optionCountByElement = new Map<string, number>();
  for (const o of openOptions ?? []) {
    optionCountByElement.set(o.element_id, (optionCountByElement.get(o.element_id) ?? 0) + 1);
  }
  const lockedValueById = new Map(
    (lockedOptions ?? []).map((o) => [o.id, o.value as Record<string, unknown>]),
  );

  const fundingByElement = new Map<string, FundingStatus>();
  let totalRequired = 0;
  let totalActual = 0;
  for (const fr of fundingRows ?? []) {
    for (const fre of fr.funding_request_elements) {
      fundingByElement.set(fre.element_id, fr.status);
    }
    totalRequired += fr.required_amount;
    if (fr.status === "booked") totalActual += fr.actual_amount_paid ?? fr.required_amount;
  }

  const overviewElements: OverviewElement[] = rows.map((row, idx) => {
    const lockedValue = row.locked_option_id
      ? lockedValueById.get(row.locked_option_id) ?? null
      : null;
    const info = describeElementStatus({
      type: row.type,
      state: row.state,
      lockedVia: row.locked_via,
      fundingStatus: fundingByElement.get(row.id) ?? null,
      optionCount: optionCountByElement.get(row.id) ?? 0,
      optionsDeadline: row.options_deadline,
      lockedValue,
      bookedAt: row.booked_at,
    });
    return {
      id: row.id,
      type: row.type,
      symbol: ELEMENT_SYMBOLS[row.type],
      label: row.label,
      num: String(idx + 1).padStart(2, "0"),
      tier: info.tier,
      statusLabel: info.statusLabel,
      detail: info.detail,
      href: `/trips/${tripId}/elements/${row.id}`,
      schedule: getElementSchedule(row.type, row.state, row.metadata, lockedValue),
    };
  });

  // §7: destination/dates line — whatever's actually locked (explicit
  // element, or the Accommodations fallback), never a fabricated range.
  const datesLabel = tripContext.dates?.start_date
    ? `${formatDate(tripContext.dates.start_date)}${
        tripContext.dates.end_date ? ` – ${formatDate(tripContext.dates.end_date)}` : ""
      }`
    : tripContext.dates?.nights
      ? `${tripContext.dates.nights} nights`
      : null;
  const tripSubheader = [tripContext.destination?.name, datesLabel].filter(Boolean).join(" · ") || null;

  // Itinerary/Calendar need a real anchored range — the "N nights, no start
  // date picked yet" mode (see DatesValue's own doc comment) has nothing to
  // build a day grid from.
  const tripDates =
    tripContext.dates?.start_date && tripContext.dates?.end_date
      ? { start: tripContext.dates.start_date, end: tripContext.dates.end_date }
      : null;

  return (
    <div className="flex flex-1 flex-col items-center gap-8 px-6 py-16">
      {totalRequired > 0 && (
        <div className="flex w-full max-w-2xl items-center justify-between rounded-lg border border-black/[.1] px-4 py-3 text-sm dark:border-white/[.14]">
          <span className="text-zinc-500">Budgeted vs. actual</span>
          <span className="font-medium text-black dark:text-zinc-50">
            {totalActual > 0 ? `${totalActual.toFixed(2)} actual · ` : ""}
            {totalRequired.toFixed(2)} required
          </span>
        </div>
      )}

      <TripOverview
        tripId={tripId}
        tripName={trip.name}
        subheader={tripSubheader}
        canManage={Boolean(canManage)}
        addElementModal={
          <AddElementModal
            tripId={tripId}
            currentUserId={user.id}
            isOrganizer={Boolean(canManage)}
            roster={addElementRoster}
            tripContext={tripContext}
          />
        }
        elements={overviewElements}
        tripDates={tripDates}
        destinationName={tripContext.destination?.name ?? null}
      />
    </div>
  );
}
