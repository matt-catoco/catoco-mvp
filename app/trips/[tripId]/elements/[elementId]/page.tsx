import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ELEMENT_METADATA_FIELDS, type ElementType } from "@/lib/trip-elements";
import { OptionSummary } from "@/components/option-summary";
import { StatusBadge } from "@/components/status-badge";
import { SubmitOptionForm } from "../../submit-option-form";
import { VotingSection } from "../../voting-section";
import { resolveAndNotify } from "../../resolve-elements";
import { EditElementForm } from "../../edit-element-form";
import { FundingCard, type FundingRequestInfo } from "../../funding-card";
import { BookingConfirmation } from "../../booking-confirmation";

type ElementRow = {
  id: string;
  type: ElementType;
  label: string;
  metadata: Record<string, string>;
  state: "locked" | "open";
  options_deadline: string | null;
  voting_deadline: string | null;
  tie_notified: boolean;
  empty_notified: boolean;
  locked_option_id: string | null;
  booked_at: string | null;
  created_by: string | null;
};

type FundingRow = {
  id: string;
  required_amount: number;
  status: "collecting" | "ready_to_purchase" | "booked";
  funding_deadline: string | null;
  purchaser_id: string | null;
  actual_amount_paid: number | null;
};

type RosterRow = { user_id: string; display_name: string | null; is_organizer: boolean };

type OptionRow = {
  id: string;
  value: Record<string, unknown>;
  proposed_by: string | null;
};

function MetadataLine({ type, metadata }: { type: ElementType; metadata: Record<string, string> }) {
  const fields = ELEMENT_METADATA_FIELDS[type];
  const parts = fields
    .map((f) => {
      const raw = metadata?.[f.key];
      if (!raw) return null;
      const display = f.options?.find((o) => o.value === raw)?.label ?? raw;
      return `${f.label}: ${display}`;
    })
    .filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="mt-1 text-xs text-zinc-500">{parts.join(" · ")}</p>;
}

/**
 * Drill-in target for a Trip Home tile — one element's full detail. Locked
 * renders read-only; open reuses VotingSection + SubmitOptionForm exactly
 * as before. RLS (is_element_member) does the scope enforcement — this page
 * doesn't need its own membership check beyond what the queries already
 * rely on.
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

  await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, organizer_id")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) redirect(`/trips/${tripId}`);

  // Lazy auto-lock, shared with the dashboard — a direct link to this page
  // (skipping the dashboard) must still catch a just-passed deadline.
  await resolveAndNotify(supabase, tripId, trip.organizer_id, trip.name);

  const { data: element } = await supabase
    .from("trip_elements")
    .select(
      "id, type, label, metadata, state, options_deadline, voting_deadline, tie_notified, empty_notified, locked_option_id, booked_at, created_by",
    )
    .eq("id", elementId)
    .eq("trip_id", tripId)
    .maybeSingle()
    .returns<ElementRow>();

  // RLS (is_element_member) already hides elements outside the viewer's
  // scope — a null here means either it doesn't exist or they're not in it.
  if (!element) redirect(`/trips/${tripId}`);

  const { data: canManage } = await supabase.rpc("is_trip_organizer", { p_trip_id: tripId });
  const canEdit = Boolean(canManage) || element.created_by === user.id;

  let body: ReactNode;

  if (element.state === "locked") {
    const { data: option } = element.locked_option_id
      ? await supabase
          .from("element_options")
          .select("value")
          .eq("id", element.locked_option_id)
          .maybeSingle()
      : { data: null };

    const { data: fundingRow } = await supabase
      .from("funding_requests")
      .select(
        "id, required_amount, status, funding_deadline, purchaser_id, actual_amount_paid, funding_request_elements!inner(element_id)",
      )
      .eq("funding_request_elements.element_id", element.id)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .returns<FundingRow>();

    let funding: FundingRequestInfo | null = null;
    if (fundingRow) {
      const [{ data: collected }, { data: rosterData }] = await Promise.all([
        supabase.rpc("get_funding_collected", { p_funding_request_id: fundingRow.id }),
        supabase.rpc("get_trip_roster", { p_trip_id: tripId }),
      ]);
      const roster = (rosterData ?? []) as RosterRow[];
      const purchaser = roster.find((r) => r.user_id === fundingRow.purchaser_id);
      funding = {
        id: fundingRow.id,
        requiredAmount: fundingRow.required_amount,
        collected: (collected as number) ?? 0,
        status: fundingRow.status,
        deadline: fundingRow.funding_deadline,
        purchaserId: fundingRow.purchaser_id,
        purchaserName:
          fundingRow.purchaser_id === user.id
            ? "You"
            : purchaser?.display_name?.trim() || (purchaser?.is_organizer ? "Organizer" : "Member"),
        actualAmountPaid: fundingRow.actual_amount_paid,
      };
    }

    const badgeLabel = element.booked_at
      ? "Booked"
      : funding?.status === "ready_to_purchase"
        ? "Funded"
        : "Confirmed";

    body = (
      <div className="w-full max-w-xl rounded-xl border border-black/[.1] p-4 text-left dark:border-white/[.14]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-black dark:text-zinc-50">
            {element.label}
          </span>
          <StatusBadge
            state={element.booked_at ? "funded" : funding?.status === "ready_to_purchase" ? "funded" : "locked"}
            label={badgeLabel}
          />
        </div>
        <MetadataLine type={element.type} metadata={element.metadata} />
        <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          {option ? <OptionSummary type={element.type} value={option.value} /> : "?"}
        </div>
        {canEdit && !element.booked_at && (
          <div className="mt-3">
            <EditElementForm
              tripId={tripId}
              elementId={element.id}
              type={element.type}
              state="locked"
              initialLabel={element.label}
              initialMetadata={element.metadata ?? {}}
              initialOptionsDeadline={null}
              initialVotingDeadline={null}
              initialLockedValue={option?.value ?? {}}
            />
          </div>
        )}

        {!element.booked_at &&
          (funding ? (
            <FundingCard
              tripId={tripId}
              elementId={element.id}
              currentUserId={user.id}
              canManage={Boolean(canManage)}
              funding={funding}
            />
          ) : (
            canEdit && <BookingConfirmation tripId={tripId} elementId={element.id} />
          ))}
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
            {element.label}
          </span>
          <StatusBadge state="open" label="Collecting ideas" />
        </div>
        <MetadataLine type={element.type} metadata={element.metadata} />
        {canEdit && (
          <div className="mt-2">
            <EditElementForm
              tripId={tripId}
              elementId={element.id}
              type={element.type}
              state="open"
              initialLabel={element.label}
              initialMetadata={element.metadata ?? {}}
              initialOptionsDeadline={element.options_deadline}
              initialVotingDeadline={element.voting_deadline}
              initialLockedValue={null}
            />
          </div>
        )}

        {(element.options_deadline || element.voting_deadline) && (
          <p className="mt-2 text-xs text-zinc-500">
            {element.options_deadline && `Submissions by ${element.options_deadline.slice(0, 10)}`}
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
              tripId={tripId}
              elementId={element.id}
              elementType={element.type}
              options={(options ?? []).map((o) => ({
                id: o.id,
                value: o.value,
                score: scoresByOption.get(o.id) ?? 0,
                proposedBy: o.proposed_by,
              }))}
              myRanking={myRanking}
              votingDeadline={element.voting_deadline}
              currentUserId={user.id}
              canManage={Boolean(canManage)}
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
