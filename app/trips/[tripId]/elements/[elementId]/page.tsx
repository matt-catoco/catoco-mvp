import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeParticipantsStatus,
  ELEMENT_LABELS,
  PARTICIPANTS_STATUS_LABELS,
  summarizeOptionValue,
  type ElementType,
  type ParticipantsValue,
} from "@/lib/trip-elements";
import { InviteLink } from "../../invite-link";
import { SubmitOptionForm } from "../../submit-option-form";
import { VotingSection } from "../../voting-section";
import { resolveAndNotify } from "../../resolve-elements";

type ElementRow = {
  id: string;
  category: "macro" | "micro";
  type: ElementType;
  state: "locked" | "open";
  options_deadline: string | null;
  voting_deadline: string | null;
  tie_notified: boolean;
  empty_notified: boolean;
  locked_option_id: string | null;
  invites_sent: boolean;
};

type OptionRow = {
  id: string;
  value: Record<string, unknown>;
  proposed_by: string | null;
};

/**
 * Drill-in target for a Trip Home tile — one element's full detail, split
 * out of what used to be inline on the trip page (flow #3 batches 1–2) so
 * that page can become the tile dashboard. Locked elements render read-only;
 * open ones reuse VotingSection + SubmitOptionForm exactly as before, just
 * scoped to this one element instead of every open element at once.
 */
export default async function ElementDetailPage({
  params,
}: {
  params: Promise<{ tripId: string; elementId: string }>;
}) {
  const { tripId, elementId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}/elements/${elementId}`)}`,
    );
  }

  // Same membership-first pattern as the trip page — a no-op for the
  // organizer, idempotent for an already-joined participant.
  await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, organizer_id")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) redirect(`/trips/${tripId}`);

  const isOrganizer = trip.organizer_id === user.id;

  // Lazy auto-lock, shared with the dashboard — a direct link to this page
  // (skipping the dashboard) must still catch a just-passed deadline.
  await resolveAndNotify(supabase, tripId, trip.organizer_id, trip.name);

  const { data: element } = await supabase
    .from("trip_elements")
    .select(
      "id, category, type, state, options_deadline, voting_deadline, tie_notified, empty_notified, locked_option_id, invites_sent",
    )
    .eq("id", elementId)
    .eq("trip_id", tripId)
    .maybeSingle()
    .returns<ElementRow>();

  if (!element) redirect(`/trips/${tripId}`);

  let body: ReactNode;

  // Guarded on state === "locked" too — the wizard allows Participants to be
  // left "open" like any other element (voted on via candidate ranges), in
  // which case it isn't the fixed range this branch renders and falls
  // through to the generic open/voting branch below instead.
  if (element.type === "participants" && element.state === "locked") {
    const [{ data: option }, { count }] = await Promise.all([
      element.locked_option_id
        ? supabase
            .from("element_options")
            .select("value")
            .eq("id", element.locked_option_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("element_participants")
        .select("*", { count: "exact", head: true })
        .eq("element_id", element.id)
        .eq("opted_in", true),
    ]);

    const value = (option?.value ?? {}) as ParticipantsValue;
    const optedInCount = count ?? 0;
    const status = computeParticipantsStatus({
      min: value.min ?? null,
      max: value.max ?? null,
      invitesSent: element.invites_sent,
      optedInCount,
    });

    body = (
      <div className="w-full max-w-xl rounded-xl border border-black/[.1] p-4 text-left dark:border-white/[.14]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Participants</h2>
          <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
            {PARTICIPANTS_STATUS_LABELS[status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {optedInCount} joined
          {value.min != null && ` · needs ${value.min}`}
          {value.max != null && ` · caps at ${value.max}`}
        </p>
        {isOrganizer && (
          <InviteLink tripId={tripId} initialInvitesSent={element.invites_sent} />
        )}
      </div>
    );
  } else if (element.state === "locked") {
    const { data: option } = element.locked_option_id
      ? await supabase
          .from("element_options")
          .select("value")
          .eq("id", element.locked_option_id)
          .maybeSingle()
      : { data: null };

    body = (
      <div className="w-full max-w-xl rounded-xl border border-black/[.1] p-4 text-left dark:border-white/[.14]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-black dark:text-zinc-50">
            {ELEMENT_LABELS[element.type]}
          </span>
          <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
            Settled
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          {option ? summarizeOptionValue(element.type, option.value) : "?"}
        </p>
      </div>
    );
  } else {
    const { data: options } = await supabase
      .from("element_options")
      .select("id, value, proposed_by")
      .eq("element_id", element.id)
      .returns<OptionRow[]>();

    const optionIds = (options ?? []).map((o) => o.id);

    const [{ data: scoreRows }, { data: myVotes }] = await Promise.all([
      supabase.rpc("borda_scores", { p_element_id: element.id }),
      optionIds.length
        ? supabase
            .from("votes")
            .select("option_id, rank")
            .eq("participant_id", user.id)
            .in("option_id", optionIds)
            .order("rank")
        : Promise.resolve({ data: [] as { option_id: string; rank: number }[] }),
    ]);

    const scoresByOption = new Map<string, number>(
      ((scoreRows ?? []) as { option_id: string; score: number }[]).map((r) => [
        r.option_id,
        r.score,
      ]),
    );
    const myRanking = (myVotes ?? []).map((v) => v.option_id);

    body = (
      <div className="w-full max-w-xl text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-black dark:text-zinc-50">
            {ELEMENT_LABELS[element.type]}
          </span>
          <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
            Collecting ideas
          </span>
        </div>

        {(element.options_deadline || element.voting_deadline) && (
          <p className="mt-2 text-xs text-zinc-500">
            {element.options_deadline && `Options by ${element.options_deadline.slice(0, 10)}`}
            {element.options_deadline && element.voting_deadline && " · "}
            {element.voting_deadline && `Vote by ${element.voting_deadline.slice(0, 10)}`}
          </p>
        )}

        {element.tie_notified && (
          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Voting closed in a tie — this needs the organizer to pick a winner.
          </p>
        )}
        {element.empty_notified && (
          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            The options deadline passed with nothing submitted.
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {(options ?? []).length > 0 ? (
            <VotingSection
              elementId={element.id}
              elementType={element.type}
              options={(options ?? []).map((o) => ({
                id: o.id,
                value: o.value,
                score: scoresByOption.get(o.id) ?? 0,
              }))}
              myRanking={myRanking}
              votingDeadline={element.voting_deadline}
            />
          ) : (
            <p className="text-xs text-zinc-500">No options yet.</p>
          )}

          <SubmitOptionForm elementId={element.id} type={element.type} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-16 text-center">
      <div className="w-full max-w-xl text-left">
        <Link
          href={`/trips/${tripId}`}
          className="text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-zinc-50"
        >
          ← {trip.name}
        </Link>
      </div>
      {body}
    </div>
  );
}
