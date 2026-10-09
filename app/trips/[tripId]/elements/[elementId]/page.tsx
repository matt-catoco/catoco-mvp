import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyInvited } from "@/lib/notifications";
import {
  ELEMENT_METADATA_FIELDS,
  PRICE_BEARING_TYPES,
  describeElementStatus,
  formatCurrency,
  formatDate,
  type ElementType,
} from "@/lib/trip-elements";
import { BookingSnapshot } from "@/components/booking-snapshot";
import { StatusBadge } from "@/components/status-badge";
import { SubmitOptionForm } from "../../submit-option-form";
import { VotingSection } from "../../voting-section";
import { resolveAndNotify } from "../../resolve-elements";
import { EditElementForm } from "../../edit-element-form";
import {
  FundingCard,
  type FundingRequestInfo,
  type BundleMemberInfo,
  type FundingPayments,
} from "../../funding-card";
import type { MyMandateInfo } from "../../mandate-panel";
import type { PaymentRosterEntry, PaymentState } from "../../payment-status";
import { stripeConfigured } from "@/lib/stripe/server";
import type { PriceInfo } from "../../price-check";
import { cushionLabel } from "@/lib/trip-permissions";
import { createServiceClient } from "@/lib/supabase/service";
import { CONFIRMATION_BUCKET } from "@/lib/booking-confirmation";
import { ConfirmationDetails } from "@/components/confirmation-details";
import { ElementScopePanel, type ScopeMember } from "../../participation-controls";
import { BookingConfirmation } from "../../booking-confirmation";
import { getTripContext } from "../../trip-context";
import { NudgeButton } from "../../nudge-button";

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
  locked_via: "organizer" | "vote" | "creator" | null;
  booked_at: string | null;
  created_by: string | null;
  confirmation_details: string | null;
  confirmation_attachment_path: string | null;
  bundle_group_id: string | null;
  scope_all: boolean;
  spots: number | null;
  cushion_kind: string | null;
  cushion_value: number | null;
};

type FundingRow = {
  id: string;
  required_amount: number;
  individual_amount: number | null;
  status: "collecting" | "ready_to_purchase" | "booked";
  funding_deadline: string | null;
  purchaser_id: string | null;
  actual_amount_paid: number | null;
  refunded_at: string | null;
  currency: string | null;
  charge_status: "charging" | "charged" | "failed" | null;
  charge_failure_reason: string | null;
  refund_all_requested_at: string | null;
  previous_individual_amount: number | null;
  price_changed_at: string | null;
};

type MandateRow = {
  id: string;
  participant_id: string;
  status: MyMandateInfo["status"];
  payment_method_type: MyMandateInfo["paymentMethodType"];
  failure_reason: string | null;
  created_at: string;
  max_amount: number | null;
  retry_reason: string | null;
};

type ContributionRow = {
  contributor_id: string;
  source: "manual" | "stripe";
  amount: number;
  payment_method_type: string | null;
  refunded_at: string | null;
  stripe_refund_id: string | null;
  created_at: string;
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
  return <p className="mt-1 text-xs text-brand-muted">{parts.join(" · ")}</p>;
}

/**
 * Drill-in target for a Trip Home tile — one element's full detail. Locked
 * renders read-only. Open phase-gates on options_deadline (§11): before it
 * passes, SubmitOptionForm shows alongside a read-only VotingSection (options
 * visible, not yet rankable); once it passes, submissions close and
 * VotingSection becomes interactive — never both propose and rank at once.
 * RLS (is_element_member) does the scope enforcement — this page
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

  const { data: justJoined } = await supabase.rpc("join_trip", { p_trip_id: tripId });

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, organizer_id")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) redirect(`/trips/${tripId}`);

  // Lazy auto-lock, shared with the dashboard — a direct link to this page
  // (skipping the dashboard) must still catch a just-passed deadline.
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

  const { data: element } = await supabase
    .from("trip_elements")
    .select(
      "id, type, label, metadata, state, options_deadline, voting_deadline, tie_notified, empty_notified, locked_option_id, locked_via, booked_at, created_by, confirmation_details, confirmation_attachment_path, bundle_group_id, scope_all, spots, cushion_kind, cushion_value",
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
  // Nudge: organizer-only, whoever hasn't acted in the current phase.
  const nudgeTargets = canManage
    ? (((await supabase.rpc("get_element_nudge_targets", { p_element_id: elementId })).data ?? []) as {
        participant_id: string;
        display_name: string | null;
        phase: string;
      }[])
    : [];

  let body: ReactNode;

  if (element.state === "locked") {
    const { data: option } = element.locked_option_id
      ? await supabase
          .from("element_options")
          .select("value, unit_price, pricing_basis")
          .eq("id", element.locked_option_id)
          .maybeSingle()
      : { data: null };

    const { data: fundingRow } = await supabase
      .from("funding_requests")
      .select(
        "id, required_amount, individual_amount, status, funding_deadline, purchaser_id, actual_amount_paid, refunded_at, currency, charge_status, charge_failure_reason, refund_all_requested_at, previous_individual_amount, price_changed_at, funding_request_elements!inner(element_id)",
      )
      .eq("funding_request_elements.element_id", element.id)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .returns<FundingRow>();

    // Element-scoped participants (who this is actually for) — fetched
    // regardless of whether a funding_request exists yet, since "who's this
    // for" is part of the full snapshot (BookingSnapshot below), not just a
    // funding-flow detail. Real identities, not just a count, so the
    // snapshot can list names.
    const [{ data: scopedParticipantRows }, { data: rosterData }] = await Promise.all([
      supabase
        .from("element_participants")
        .select("participant_id")
        .eq("element_id", element.id)
        .eq("opted_in", true),
      supabase.rpc("get_trip_roster", { p_trip_id: tripId }),
    ]);
    const roster = (rosterData ?? []) as RosterRow[];
    const rosterById = new Map(roster.map((r) => [r.user_id, r]));
    const scopedParticipants = (scopedParticipantRows ?? []).map((row) => {
      const r = rosterById.get(row.participant_id);
      return {
        userId: row.participant_id,
        displayName:
          row.participant_id === user.id
            ? "You"
            : r?.display_name?.trim() || (r?.is_organizer ? "Organizer" : "Member"),
      };
    });

    let funding: FundingRequestInfo | null = null;
    let fundingRoster: RosterRow[] = [];
    let bundleMembers: BundleMemberInfo[] = [];
    let payments: FundingPayments | undefined;
    let priceInfo: PriceInfo | undefined;
    if (fundingRow) {
      const optionValue = (option?.value ?? {}) as Record<string, unknown>;
      const { data: cushionTrip } = await supabase
        .from("trips")
        .select("price_cushion_kind, price_cushion_value")
        .eq("id", tripId)
        .maybeSingle();
      const vendor = String(optionValue.vendor_source ?? "");
      priceInfo = {
        unitPrice: option?.unit_price ?? null,
        basisSuffix:
          option?.pricing_basis === "per_person"
            ? "/person"
            : option?.pricing_basis === "per_night"
              ? optionValue.mode === "rental_car"
                ? "/day"
                : "/night"
              : "",
        vendorLabel: vendor === "duffel" ? "Duffel" : vendor === "liteapi" ? "LiteAPI" : null,
        cushionLabel: cushionLabel(
          element.cushion_kind ?? cushionTrip?.price_cushion_kind,
          element.cushion_kind ? element.cushion_value : cushionTrip?.price_cushion_value,
          fundingRow.currency ?? String(optionValue.currency ?? "USD"),
        ),
        previousShare: fundingRow.previous_individual_amount,
        priceChangedAt: fundingRow.price_changed_at,
      };
      const { data: collected } = await supabase.rpc("get_funding_collected", {
        p_funding_request_id: fundingRow.id,
      });
      fundingRoster = roster;
      const purchaser = roster.find((r) => r.user_id === fundingRow.purchaser_id);
      funding = {
        id: fundingRow.id,
        requiredAmount: fundingRow.required_amount,
        individualAmount: fundingRow.individual_amount ?? fundingRow.required_amount,
        collected: (collected as number) ?? 0,
        status: fundingRow.status,
        deadline: fundingRow.funding_deadline,
        purchaserId: fundingRow.purchaser_id,
        purchaserName:
          fundingRow.purchaser_id === user.id
            ? "You"
            : purchaser?.display_name?.trim() || (purchaser?.is_organizer ? "Organizer" : "Member"),
        actualAmountPaid: fundingRow.actual_amount_paid,
        refundedAt: fundingRow.refunded_at,
        chargeStatus: fundingRow.charge_status,
      };

      // Flow #4: mandate-based payments, only where Stripe (test mode) is
      // configured — elsewhere the card keeps the manual Commit ledger.
      if (stripeConfigured()) {
        // RLS scopes these: the organizer reads every mandate on the
        // request, a participant only their own. Contributions are visible
        // to all members (existing policy).
        const [{ data: mandateRows }, { data: summaryRows }, { data: contributionRows }, { data: spotsFull }, { data: capAmount }, { data: retryRows }] = await Promise.all([
          supabase
            .from("funding_mandates")
            .select("id, participant_id, status, payment_method_type, failure_reason, created_at, max_amount, retry_reason")
            .eq("funding_request_id", fundingRow.id)
            .order("created_at", { ascending: false })
            .returns<MandateRow[]>(),
          supabase.rpc("get_funding_mandate_summary", { p_funding_request_id: fundingRow.id }),
          supabase
            .from("funding_contributions")
            .select("contributor_id, source, amount, payment_method_type, refunded_at, stripe_refund_id, created_at")
            .eq("funding_request_id", fundingRow.id)
            .order("created_at", { ascending: false })
            .returns<ContributionRow[]>(),
          supabase.rpc("funding_request_spots_full", { p_funding_request_id: fundingRow.id, p_user_id: user.id }),
          supabase.rpc("funding_request_cushion_cap", {
            p_funding_request_id: fundingRow.id,
            p_individual: fundingRow.individual_amount ?? fundingRow.required_amount,
          }),
          fundingRow.charge_status === "charging"
            ? supabase.rpc("get_funding_retry_status", { p_funding_request_id: fundingRow.id })
            : Promise.resolve({ data: null }),
        ]);
        const retryRow = (Array.isArray(retryRows) ? retryRows[0] : retryRows) as
          | { waiting: number; held: number; total: number; retry_deadline: string | null; hold_cap_at: string | null }
          | null
          | undefined;
        const summary = (Array.isArray(summaryRows) ? summaryRows[0] : summaryRows) as
          | { population: number; covered: number }
          | undefined;
        const mandates = mandateRows ?? [];
        const contributions = contributionRows ?? [];
        // Rows are newest-first, so the first match per person is their latest.
        const latestMandate = (uid: string) => mandates.find((m) => m.participant_id === uid);
        const latestContribution = (uid: string) => contributions.find((c) => c.contributor_id === uid);
        const mandateRow = latestMandate(user.id);
        const myContribution = latestContribution(user.id);

        const isOrganizerView = Boolean(canManage);
        const rosterIds = isOrganizerView
          ? [
              ...new Set([
                ...scopedParticipants.map((p) => p.userId),
                ...mandates.map((m) => m.participant_id),
                ...contributions.map((c) => c.contributor_id),
              ]),
            ]
          : [user.id];
        const paymentRoster: PaymentRosterEntry[] = rosterIds.map((uid) => {
          const r = rosterById.get(uid);
          const displayName =
            uid === user.id ? "You" : r?.display_name?.trim() || (r?.is_organizer ? "Organizer" : "Member");
          const c = latestContribution(uid);
          const m = latestMandate(uid);
          const method = (c?.payment_method_type ?? m?.payment_method_type ?? null) as PaymentRosterEntry["method"];
          let state: PaymentState = "not_authorized";
          let detail: string | null = null;
          if (c) {
            state = c.refunded_at
              ? "refunded"
              : c.stripe_refund_id
                ? "refund_pending"
                : fundingRow.status === "booked"
                  ? "used"
                  : "paid";
            detail = formatCurrency(c.amount, fundingRow.currency ?? "USD");
          } else if (m) {
            state = (
              {
                pending: "started",
                active: "authorized",
                charging: "charging",
                held: "on_hold",
                awaiting_retry: "needs_retry",
                charge_succeeded: "paid",
                charge_failed: "charge_failed",
                refunded: "refunded",
                canceled: "canceled",
              } as const
            )[m.status];
            if (m.status === "charge_failed" || m.status === "canceled") detail = m.failure_reason;
          }
          return { userId: uid, displayName, state, method, detail };
        });

        const held = contributions.filter((c) => c.source === "stripe" && !c.refunded_at);
        payments = {
          panel: {
            chargeFailureReason: fundingRow.charge_failure_reason,
            myMandate: mandateRow
              ? {
                  id: mandateRow.id,
                  status: mandateRow.status,
                  paymentMethodType: mandateRow.payment_method_type,
                  failureReason: mandateRow.failure_reason,
                  maxAmount: mandateRow.max_amount,
                  retryReason: mandateRow.retry_reason,
                }
              : null,
            population: summary?.population ?? 0,
            covered: summary?.covered ?? 0,
            // A Stripe-sourced row also lands here once charged; the panel's
            // charge-state branches take precedence over this in that case.
            alreadyContributed: Boolean(myContribution && !myContribution.refunded_at) && !mandateRow,
            // Every spot committed by others: this viewer is waitlisted.
            waitlisted: Boolean(spotsFull),
            // "Up to" for a new authorization: share + the price cushion.
            capAmount: (capAmount as number | null) ?? null,
            retry: retryRow
              ? {
                  waiting: retryRow.waiting,
                  held: retryRow.held,
                  total: retryRow.total,
                  retryDeadline: retryRow.retry_deadline,
                  holdCapAt: retryRow.hold_cap_at,
                }
              : null,
            isOrganizerView,
          },
          roster: paymentRoster,
          isOrganizerView,
          heldAmount: held.reduce((sum, c) => sum + Number(c.amount), 0),
          heldCount: held.length,
          refundRequestedAt: fundingRow.refund_all_requested_at,
        };
      }

      // §6 bundling UI: one combined screen listing every member of this
      // funding_request, not separate per-element funding prompts. A
      // fetch of the OTHER members only fires when this funding_request
      // actually covers more than one element (a real bundle) — the common
      // single-element case skips it entirely.
      const { data: memberLinks } = await supabase
        .from("funding_request_elements")
        .select("element_id")
        .eq("funding_request_id", fundingRow.id);
      const otherIds = (memberLinks ?? []).map((m) => m.element_id).filter((id) => id !== element.id);
      if (otherIds.length > 0) {
        const { data: otherElements } = await supabase
          .from("trip_elements")
          .select("id, type, label, locked_option_id")
          .in("id", otherIds)
          .returns<{ id: string; type: ElementType; label: string; locked_option_id: string | null }[]>();
        const otherOptionIds = (otherElements ?? [])
          .map((e) => e.locked_option_id)
          .filter((id): id is string => id != null);
        const { data: otherOptions } = otherOptionIds.length
          ? await supabase
              .from("element_options")
              .select("id, value")
              .in("id", otherOptionIds)
              .returns<{ id: string; value: Record<string, unknown> }[]>()
          : { data: [] as { id: string; value: Record<string, unknown> }[] };
        const otherValueById = new Map((otherOptions ?? []).map((o) => [o.id, o.value]));
        bundleMembers = (otherElements ?? []).map((e) => {
          const v = e.locked_option_id ? otherValueById.get(e.locked_option_id) : undefined;
          return {
            elementId: e.id,
            label: e.label,
            type: e.type,
            title: (v?.name as string) || (v?.title as string) || e.label,
            price: typeof v?.price === "number" ? (v.price as number) : null,
            currency: (v?.currency as string) || undefined,
          };
        });
      }
    }

    const status = describeElementStatus({
      type: element.type,
      state: "locked",
      lockedVia: element.locked_via,
      fundingStatus: funding?.status ?? null,
      optionCount: 0,
      optionsDeadline: null,
      lockedValue: option?.value ?? null,
      bookedAt: element.booked_at,
    });

    // The element row above was read under the viewer's own RLS (trip
    // members only), so reaching here is the access check; the private
    // bucket itself has no policies, so the service role mints a short-lived
    // read URL rather than any stored/permanent link.
    let confirmationAttachment: { url: string; isPdf: boolean } | null = null;
    if (element.confirmation_attachment_path) {
      const { data: signed } = await createServiceClient()
        .storage.from(CONFIRMATION_BUCKET)
        .createSignedUrl(element.confirmation_attachment_path, 600);
      if (signed?.signedUrl) {
        confirmationAttachment = {
          url: signed.signedUrl,
          isPdf: element.confirmation_attachment_path.toLowerCase().endsWith(".pdf"),
        };
      }
    }

    const snapshotCurrency =
      (option?.value as Record<string, unknown> | undefined)?.currency as string | undefined;
    // Funding-flow audit: while collecting, everyone cares about their own
    // per-person share, not the trip total; once it's ready to purchase or
    // booked, the organizer needs the real total (or what was actually
    // paid) and the real names. No funding_request at all (payment_type=
    // none, or an unpriced locked option) skips per-person math entirely.
    const snapshotPricing = funding
      ? {
          mode: (funding.status === "collecting" ? "funding" : "booking") as "funding" | "booking",
          totalRequired: funding.requiredAmount,
          // §5: the real fixed share, computed once server-side over the
          // bundle's full participant union — not derived here from just
          // this element's own scopedParticipantCount, which used to be
          // wrong for a bundled element with a narrower individual scope.
          perPersonShare: funding.individualAmount,
          actualPaid: funding.actualAmountPaid ?? undefined,
          currency: snapshotCurrency ?? "USD",
        }
      : undefined;

    body = (
      <div className="w-full max-w-xl rounded-xl border border-brand-line p-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-black dark:text-zinc-50">
            {element.label}
          </span>
          <StatusBadge state={status.funded ? "funded" : "locked"} label={status.statusLabel} />
        </div>
        <MetadataLine type={element.type} metadata={element.metadata} />
        <div className="mt-2">
          {option ? (
            <BookingSnapshot
              type={element.type}
              value={option.value}
              participants={scopedParticipants}
              pricing={snapshotPricing}
            />
          ) : (
            "?"
          )}
          <ConfirmationDetails details={element.confirmation_details} attachment={confirmationAttachment} />
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
              canSetSpots={Boolean(canManage) && element.type !== "dates" && element.type !== "destination"}
              initialSpots={element.spots}
              initialCushionKind={element.cushion_kind}
              initialCushionValue={element.cushion_value}
            />
          </div>
        )}

        {/* Booked elements normally drop the funding card — except when
            real Stripe payments back it: everyone's "used for booking"
            status and the Refund everyone path (a cancelled booking) have
            to stay reachable. */}
        {(!element.booked_at || (funding && payments)) &&
          (funding ? (
            <FundingCard
              tripId={tripId}
              elementId={element.id}
              currentUserId={user.id}
              canManage={Boolean(canManage)}
              funding={funding}
              roster={fundingRoster.map((r) => ({
                userId: r.user_id,
                displayName: r.display_name?.trim() || (r.is_organizer ? "Organizer" : "Member"),
              }))}
              currency={
                fundingRow?.currency ??
                ((option?.value as Record<string, unknown> | undefined)?.currency as string | undefined)
              }
              members={bundleMembers}
              payments={payments}
              priceInfo={priceInfo}
            />
          ) : (
            // Dates/Destination are never price-bearing, so `funding` is
            // always null for them too — that's not "locked but missing a
            // funding request," there's nothing to book at all for these
            // two types.
            canEdit &&
            PRICE_BEARING_TYPES.includes(element.type) && (
              <BookingConfirmation tripId={tripId} elementId={element.id} />
            )
          ))}
      </div>
    );
  } else {
    const [{ data: options }, tripContext] = await Promise.all([
      supabase
        .from("element_options")
        .select("id, value, proposed_by")
        .eq("element_id", element.id)
        .returns<OptionRow[]>(),
      getTripContext(supabase, tripId),
    ]);

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

    // "Who's in": scope rows (RLS shows organizers every row, a participant
    // their own) joined to the roster. Organizers also see trip members who
    // aren't in scope at all, so they can add them.
    const [{ data: scopeRows }, { data: scopeRoster }] = await Promise.all([
      supabase
        .from("element_participants")
        .select("participant_id, opted_in")
        .eq("element_id", element.id)
        .returns<{ participant_id: string; opted_in: boolean }[]>(),
      supabase.rpc("get_trip_roster", { p_trip_id: tripId }),
    ]);
    const optedInById = new Map((scopeRows ?? []).map((r) => [r.participant_id, r.opted_in]));
    const scopeMembers: ScopeMember[] = ((scopeRoster ?? []) as RosterRow[])
      .filter((r) => canManage || r.user_id === user.id)
      .map((r) => ({
        userId: r.user_id,
        displayName: r.display_name?.trim() || (r.is_organizer ? "Organizer" : "Member"),
        optedIn: optedInById.has(r.user_id) ? optedInById.get(r.user_id)! : null,
      }))
      .filter((m) => canManage || m.optedIn !== null);
    const iOptedOut = optedInById.get(user.id) === false;

    // Trip setting: a participant may lock in their own SUBGROUP element
    // (never an Everyone one) — lock_element() enforces the same rule.
    const { data: lockSettings } = await supabase
      .from("trips")
      .select("allow_participant_subgroups")
      .eq("id", tripId)
      .maybeSingle();
    const creatorCanLock =
      Boolean(lockSettings?.allow_participant_subgroups) && !element.scope_all && element.created_by === user.id;

    const status = describeElementStatus({
      type: element.type,
      state: "open",
      lockedVia: null,
      fundingStatus: null,
      optionCount: (options ?? []).length,
      optionsDeadline: element.options_deadline,
      lockedValue: null,
      bookedAt: null,
    });

    // §11 phase gate: propose and rank never show at once. Before the
    // submission deadline, options are visible but not yet rankable; once
    // it passes, submissions close and only the ranking view remains, all
    // the way through to lock-in. Deadlines are now mandatory at creation
    // (§1/§2), so every open element has a clean, unambiguous point to gate
    // on — no manual "close submissions" step needed.
    const stillSubmitting =
      !element.options_deadline || new Date(element.options_deadline) > new Date();

    body = (
      <div className="w-full max-w-xl text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-black dark:text-zinc-50">
            {element.label}
          </span>
          <StatusBadge state="open" label={status.statusLabel} />
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
              canSetSpots={Boolean(canManage) && element.type !== "dates" && element.type !== "destination"}
              initialSpots={element.spots}
              initialCushionKind={element.cushion_kind}
              initialCushionValue={element.cushion_value}
            />
          </div>
        )}

        {(element.options_deadline || element.voting_deadline) && (
          <p className="mt-2 text-xs text-brand-muted">
            {element.options_deadline && `Submissions by ${formatDate(element.options_deadline)}`}
            {element.options_deadline && element.voting_deadline && " · "}
            {element.voting_deadline && `Vote by ${formatDate(element.voting_deadline)}`}
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

        <ElementScopePanel
          tripId={tripId}
          elementId={element.id}
          currentUserId={user.id}
          canManage={Boolean(canManage)}
          bundled={element.bundle_group_id !== null}
          members={scopeMembers}
        />

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
              canLockAny={creatorCanLock}
              readOnly={stillSubmitting || iOptedOut}
            />
          ) : (
            <p className="text-xs text-brand-muted">No options yet.</p>
          )}

          {stillSubmitting && !iOptedOut && (
            <SubmitOptionForm elementId={element.id} type={element.type} tripContext={tripContext} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-16 text-center">
      <div className="w-full max-w-xl text-left">
        <Link
          href={`/trips/${tripId}`}
          className="text-xs font-medium text-brand-muted hover:text-black dark:hover:text-zinc-50"
        >
          ← {trip.name}
        </Link>
      </div>
      {body}
      {nudgeTargets.length > 0 && (
        <NudgeButton
          tripId={tripId}
          elementId={element.id}
          names={nudgeTargets.map((t) => t.display_name?.trim() || "Unnamed traveller")}
          phaseLabel={{ submission: "submit", voting: "vote", funding: "commit" }[nudgeTargets[0].phase] ?? "act"}
        />
      )}
    </div>
  );
}
