import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeParticipantsStatus,
  ELEMENT_LABELS,
  PARTICIPANTS_STATUS_LABELS,
  type ElementType,
  type ParticipantsValue,
} from "@/lib/trip-elements";
import { InviteLink } from "./invite-link";
import { SubmitOptionForm } from "./submit-option-form";
import { VotingSection } from "./voting-section";
import { notifyOrganizer } from "./notify";

type ElementRow = {
  id: string;
  category: "macro" | "micro";
  type: ElementType;
  state: "locked" | "open";
  options_deadline: string | null;
  voting_deadline: string | null;
  tie_notified: boolean;
  empty_notified: boolean;
};

type OptionRow = {
  id: string;
  element_id: string;
  value: Record<string, unknown>;
  proposed_by: string | null;
};

type ResolvedRow = {
  element_id: string;
  element_type: ElementType;
  reason: "tie" | "empty";
};

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

  const isOrganizer = trip.organizer_id === user.id;

  // Lazy auto-lock: resolve anything past its voting_deadline before reading
  // element state below, so a just-locked element renders as locked, not
  // stale-open. Notification is best-effort — must never break the page.
  const { data: resolvedData } = await supabase.rpc("resolve_due_elements", {
    p_trip_id: tripId,
  });
  const resolved = (resolvedData ?? null) as ResolvedRow[] | null;

  if (resolved && resolved.length > 0) {
    try {
      const { data: organizerEmail } = await supabase.rpc("get_user_email", {
        p_user_id: trip.organizer_id,
      });
      if (organizerEmail) {
        const h = await headers();
        const host = h.get("host");
        const proto = process.env.NODE_ENV === "development" ? "http" : "https";
        const origin = host ? `${proto}://${host}` : "https://catoco.co";
        await Promise.all(
          resolved.map((r) =>
            notifyOrganizer({
              reason: r.reason,
              elementType: r.element_type,
              tripId,
              tripName: trip.name,
              organizerEmail,
              origin,
            }),
          ),
        );
      }
    } catch {
      // best-effort — a notification failure must never break the page
    }
  }

  const { data: elements } = await supabase
    .from("trip_elements")
    .select(
      "id, category, type, state, options_deadline, voting_deadline, tie_notified, empty_notified",
    )
    .eq("trip_id", tripId)
    .order("category")
    .order("type")
    .returns<ElementRow[]>();

  const openElementIds = (elements ?? [])
    .filter((e) => e.state === "open")
    .map((e) => e.id);

  const { data: options } = openElementIds.length
    ? await supabase
        .from("element_options")
        .select("id, element_id, value, proposed_by")
        .in("element_id", openElementIds)
        .returns<OptionRow[]>()
    : { data: [] as OptionRow[] };

  const optionsByElement = new Map<string, OptionRow[]>();
  for (const opt of options ?? []) {
    const list = optionsByElement.get(opt.element_id) ?? [];
    list.push(opt);
    optionsByElement.set(opt.element_id, list);
  }

  // Live Borda standings per open element — borda_scores() is the single
  // source of truth, same function the auto-lock resolution above used.
  const scoresByOption = new Map<string, number>();
  await Promise.all(
    openElementIds.map(async (elId) => {
      const { data } = await supabase.rpc("borda_scores", { p_element_id: elId });
      const rows = (data ?? []) as { option_id: string; score: number }[];
      for (const row of rows) scoresByOption.set(row.option_id, row.score);
    }),
  );

  // My current ranking per open element (votes RLS: self-select only).
  const allOptionIds = (options ?? []).map((o) => o.id);
  const { data: myVotes } = allOptionIds.length
    ? await supabase
        .from("votes")
        .select("option_id, rank")
        .eq("participant_id", user.id)
        .in("option_id", allOptionIds)
        .order("rank")
    : { data: [] as { option_id: string; rank: number }[] };

  const optionToElement = new Map((options ?? []).map((o) => [o.id, o.element_id]));
  const myRankingByElement = new Map<string, string[]>();
  for (const v of myVotes ?? []) {
    const elId = optionToElement.get(v.option_id);
    if (!elId) continue;
    const list = myRankingByElement.get(elId) ?? [];
    list.push(v.option_id);
    myRankingByElement.set(elId, list);
  }

  // Organizer-only: participants range + invite link, if that element is locked.
  let participantsSection: ReactNode = null;
  if (isOrganizer) {
    const participantsElement = (elements ?? []).find(
      (e) => e.type === "participants" && e.state === "locked",
    );
    if (participantsElement) {
      const [{ data: option }, { count }, { data: invitesRow }] = await Promise.all([
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
        supabase
          .from("trip_elements")
          .select("invites_sent")
          .eq("id", participantsElement.id)
          .single(),
      ]);

      const value = (option?.value ?? {}) as ParticipantsValue;
      const invitesSent = invitesRow?.invites_sent ?? false;
      const optedInCount = count ?? 0;
      const status = computeParticipantsStatus({
        min: value.min ?? null,
        max: value.max ?? null,
        invitesSent,
        optedInCount,
      });

      participantsSection = (
        <div className="w-full max-w-xl rounded-xl border border-black/[.1] p-4 text-left dark:border-white/[.14]">
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
          <InviteLink tripId={tripId} initialInvitesSent={invitesSent} />
        </div>
      );
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-8 px-6 py-16 text-center">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {trip.name}
        </h1>
      </div>

      {participantsSection}

      <div className="w-full max-w-xl text-left">
        <h2 className="mb-3 text-sm font-semibold text-black dark:text-zinc-50">
          Elements
        </h2>
        {!elements || elements.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nothing set up yet — trip creation is coming soon.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {elements.map((el) => {
              const elOptions = optionsByElement.get(el.id) ?? [];
              return (
                <li
                  key={el.id}
                  className="rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-black dark:text-zinc-50">
                      {ELEMENT_LABELS[el.type]}
                    </span>
                    <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/[.16]">
                      {el.state === "locked" ? "Locked" : "Open"}
                    </span>
                  </div>

                  {el.state === "open" && (
                    <div className="mt-3 flex flex-col gap-2">
                      {(el.options_deadline || el.voting_deadline) && (
                        <p className="text-xs text-zinc-500">
                          {el.options_deadline &&
                            `Options by ${el.options_deadline.slice(0, 10)}`}
                          {el.options_deadline && el.voting_deadline && " · "}
                          {el.voting_deadline && `Vote by ${el.voting_deadline.slice(0, 10)}`}
                        </p>
                      )}

                      {el.tie_notified && (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                          Voting closed in a tie — this needs the organizer to
                          pick a winner.
                        </p>
                      )}
                      {el.empty_notified && (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                          The options deadline passed with nothing submitted.
                        </p>
                      )}

                      {elOptions.length > 0 ? (
                        <VotingSection
                          elementId={el.id}
                          elementType={el.type}
                          options={elOptions.map((o) => ({
                            id: o.id,
                            value: o.value,
                            score: scoresByOption.get(o.id) ?? 0,
                          }))}
                          myRanking={myRankingByElement.get(el.id) ?? []}
                          votingDeadline={el.voting_deadline}
                        />
                      ) : (
                        <p className="text-xs text-zinc-500">No options yet.</p>
                      )}

                      <SubmitOptionForm elementId={el.id} type={el.type} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
