import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyInvited } from "@/lib/notifications";
import {
  ELEMENT_METADATA_FIELDS,
  ELEMENT_SYMBOLS,
  PRICE_BEARING_TYPES,
  describeElementStatus,
  formatCurrency,
  formatDate,
  type ElementType,
} from "@/lib/trip-elements";
import { BookingSnapshot } from "@/components/booking-snapshot";
import { SubmitOptionForm } from "../../submit-option-form";
import { VotingSection } from "../../voting-section";
import { resolveAndNotify } from "../../resolve-elements";
import { ElementHeader, ElementPageUIProvider } from "../../element-header";
import { PHASE_DEADLINE, timeLeft } from "@/lib/time-left";
import { optionTitle as optionTitleOf } from "@/components/option-summary";
import {
  FundingCard,
  type FundingRequestInfo,
  type BundleMemberInfo,
  type FundingPayments,
  type CollectionInfo,
} from "../../funding-card";
import type { PledgePanelProps } from "../../pledge-panel";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import { enabledCollectionModes } from "@/lib/collection-mode-flags";
import { isCollectionMode } from "@/lib/collection-modes";
import type { MyMandateInfo } from "../../mandate-panel";
import type { PaymentRosterEntry, PaymentState } from "../../payment-status";
import { stripeConfigured } from "@/lib/stripe/server";
import type { PriceInfo } from "../../price-check";
import { cushionLabel } from "@/lib/trip-permissions";
import { createServiceClient } from "@/lib/supabase/service";
import { CONFIRMATION_BUCKET } from "@/lib/booking-confirmation";
import { BookingRecord, type BookingRecordView } from "@/components/booking-record";
import { isAutomaticBooking } from "@/lib/booking-capability";
import { recommendedCushion } from "@/lib/cushion";
import { autoRecalcAt } from "@/lib/funding-rules";
import { OpenSpotCard } from "../../open-spot-card";
import type { HeaderDialog } from "../../element-header";
import { BookingRecordForm, type BookingDraft } from "../../booking-record-form";
import { TravelerDetailsReveal, TravelerDetailsStatus, TravelerGate, TravelerRequirementEditor } from "../../traveler-details";
import { elementRequirement, hasCompleteDetails, requirementAppliesTo, travelerDetailsProgress } from "@/lib/traveler-details";
import { decryptJson, travelerCryptoConfigured } from "@/lib/traveler-crypto";
import type { TravelerDetails, TravelerRequirement } from "@/lib/traveler-fields";
import { ElementScopePanel, OptOutButton, type ScopeMember } from "../../participation-controls";
import { getTripContext } from "../../trip-context";
import { ChangePhoto } from "../../change-photo";
import { ensureElementEnrichment, type StoredEnrichment } from "@/lib/element-enrichment";
import { readDetails } from "@/lib/option-details";

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
  bundle_group_id: string | null;
  scope_all: boolean;
  spots: number | null;
  cushion_kind: string | null;
  cushion_value: number | null;
  enriched_details: StoredEnrichment | null;
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
  platform_fee_percent: number | null;
  collection_mode: string;
  collection_mode_chosen_at: string | null;
  pay_timing: "immediate" | "after_all";
  pay_window_hours: number | null;
  pay_window_opened_at: string | null;
  shortfall_amount: number | null;
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
  platform_fee: number | null;
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

/** "Funding closes in 9h" — the header's clock label, or null without a deadline. */
function deadlineLabelFor(phase: keyof typeof PHASE_DEADLINE, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  return `${PHASE_DEADLINE[phase]} in ${timeLeft(ms)}`;
}

/** Collapsed Details summary: "Casa Mare · 12 Jun → 19 Jun · 5 guests". */
function snapshotSummary(type: ElementType, value: Record<string, unknown>, guests: number): string {
  const str = (k: string) => (typeof value[k] === "string" ? (value[k] as string).trim() : "");
  const dates = (value.dates ?? {}) as Record<string, unknown>;
  const start = (typeof dates.start_date === "string" && dates.start_date) || str("depart_date") || str("date");
  const end = (typeof dates.end_date === "string" && dates.end_date) || str("return_date");
  const when = start ? (end && end !== start ? `${formatDate(start)} → ${formatDate(end)}` : formatDate(start)) : null;
  return [optionTitleOf(type, value), when, guests > 0 ? `${guests} guest${guests === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");
}

const detailsClass = "group rounded-[18px] border-[1.5px] border-brand-line bg-brand-surface";
const summaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 rounded-[18px] px-4 py-3.5 font-[family-name:var(--font-display)] text-base font-bold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-deep [&::-webkit-details-marker]:hidden sm:px-[18px]";
function DetailsChevron() {
  return (
    <span aria-hidden className="inline-block size-2 flex-none rotate-45 border-b-2 border-r-2 border-current transition-transform group-open:-rotate-[135deg]" />
  );
}

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
/** Commit-step traveler details: an overlay opened by the commit buttons
 * (see TravelerGate) plus a one-line "saved · Edit" note once they're in. */
function MaybeTravelerGate({
  gate,
  tripId,
  elementId,
  bookerName,
  children,
}: {
  gate: { requirement: TravelerRequirement; initial: TravelerDetails; complete: boolean } | null;
  tripId: string;
  elementId: string;
  bookerName: string;
  children: ReactNode;
}) {
  if (!gate) return <>{children}</>;
  return (
    <TravelerGate tripId={tripId} elementId={elementId} bookerName={bookerName} {...gate}>
      <div className="mt-3">
        <TravelerDetailsStatus />
      </div>
      {children}
    </TravelerGate>
  );
}

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

  // "Let people add a price cushion when they commit" (founder, 2026-10-14):
  // off = no cushion anywhere — not at checkout, not in the organizer's
  // element settings. Read on its own so a missing column degrades to on.
  const { data: cushionSetting } = await supabase.from("trips").select("allow_checkout_cushion").eq("id", tripId).maybeSingle();
  const checkoutCushion = (cushionSetting as { allow_checkout_cushion?: boolean } | null)?.allow_checkout_cushion !== false;

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
      "id, type, label, metadata, state, options_deadline, voting_deadline, tie_notified, empty_notified, locked_option_id, locked_via, booked_at, created_by, bundle_group_id, scope_all, spots, cushion_kind, cushion_value, enriched_details",
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

  const nudgePhase = nudgeTargets[0] ? ({ submission: "submit", voting: "vote", funding: "commit" } as Record<string, string>)[nudgeTargets[0].phase] ?? "act" : "act";

  let body: ReactNode;

  if (element.state === "locked") {
    const { data: option } = element.locked_option_id
      ? await supabase
          .from("element_options")
          .select("value, unit_price, pricing_basis")
          .eq("id", element.locked_option_id)
          .maybeSingle()
      : { data: null };

    // B3 lock-time enrichment: first view after lock snapshots the winner's
    // details + element photo (lib/element-enrichment.ts); later views read it.
    const enrichment =
      option && element.locked_option_id
        ? await ensureElementEnrichment({
            elementId: element.id,
            type: element.type,
            lockedOptionId: element.locked_option_id,
            value: option.value as Record<string, unknown>,
            current: element.enriched_details,
          })
        : null;

    const { data: fundingRow } = await supabase
      .from("funding_requests")
      .select(
        "id, required_amount, individual_amount, status, funding_deadline, purchaser_id, actual_amount_paid, refunded_at, currency, charge_status, charge_failure_reason, refund_all_requested_at, previous_individual_amount, price_changed_at, platform_fee_percent, collection_mode, collection_mode_chosen_at, pay_timing, pay_window_hours, pay_window_opened_at, shortfall_amount, funding_request_elements!inner(element_id)",
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
    let collection: CollectionInfo | undefined;
    let pledge: PledgePanelProps | undefined;
    const locale = await getLocale();
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
        vendorLabel:
          vendor === "duffel"
            ? "Duffel"
            : vendor === "liteapi"
              ? "LiteAPI"
              : vendor === "hotelbeds" || vendor === "hotelbeds_activities" || vendor === "hotelbeds_transfers"
                ? "Hotelbeds"
                : null,
        cushionLabel: checkoutCushion
          ? cushionLabel(
              element.cushion_kind ?? cushionTrip?.price_cushion_kind,
              element.cushion_kind ? element.cushion_value : cushionTrip?.price_cushion_value,
              fundingRow.currency ?? String(optionValue.currency ?? "USD"),
            )
          : null,
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
        platformFeePercent: Number(fundingRow.platform_fee_percent ?? 0),
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

      // Collection mode (three-prong Prompt 0): which modes this environment
      // lets the organizer SELECT; every mode is still shown.
      const collectionMode = isCollectionMode(fundingRow.collection_mode) ? fundingRow.collection_mode : "catoco_psp";
      const { data: hasCommitments } = await supabase.rpc("funding_request_has_commitments", {
        p_funding_request_id: fundingRow.id,
      });
      collection = {
        mode: collectionMode,
        chosen: Boolean(fundingRow.collection_mode_chosen_at),
        locked: Boolean(hasCommitments),
        enabled: enabledCollectionModes(),
        shortfallAmount: fundingRow.shortfall_amount,
      };

      // Pledge-only (Prompt 1): pledges, the collector's payout details, and
      // who in the element hasn't pledged yet. RLS: pledges are visible to
      // the request's members; payout methods come through a members-only RPC.
      if (collectionMode === "peer_pledge" && fundingRow.collection_mode_chosen_at) {
        const [{ data: pledgeRows }, { data: methodRows }, { data: population }, { data: mySpotsFull }, { data: paidRows }] =
          await Promise.all([
            supabase
              .from("funding_pledges")
              .select("participant_id, status, reference_code")
              .eq("funding_request_id", fundingRow.id)
              .neq("status", "withdrawn")
              .order("accepted_at"),
            supabase.rpc("get_pledge_payout_methods", { p_funding_request_id: fundingRow.id }),
            supabase.rpc("funding_request_population_for", { p_funding_request_id: fundingRow.id }),
            supabase.rpc("funding_request_spots_full", { p_funding_request_id: fundingRow.id, p_user_id: user.id }),
            supabase
              .from("funding_contributions")
              .select("contributor_id, amount")
              .eq("funding_request_id", fundingRow.id)
              .is("refunded_at", null),
          ]);
        const paidBy = new Map<string, number>();
        for (const c of (paidRows ?? []) as { contributor_id: string; amount: number }[]) {
          paidBy.set(c.contributor_id, (paidBy.get(c.contributor_id) ?? 0) + Number(c.amount));
        }
        const nameOf = (id: string) => {
          const r = rosterById.get(id);
          return id === user.id ? "You" : r?.display_name?.trim() || (r?.is_organizer ? "Organizer" : "Member");
        };
        const pledges = ((pledgeRows ?? []) as { participant_id: string; status: string; reference_code: string }[]).map((p) => ({
          participantId: p.participant_id,
          displayName: nameOf(p.participant_id),
          status: p.status as "pledged" | "reported_paid" | "confirmed",
          paid: Math.round((paidBy.get(p.participant_id) ?? 0) * 100) / 100,
          reference: p.reference_code,
        }));
        const pledgedIds = new Set(pledges.map((p) => p.participantId));
        // Uploaded QR images live in a private bucket: short-lived signed URLs.
        const methods = (methodRows ?? []) as {
          id: string;
          kind: "iban" | "link" | "qr";
          label: string | null;
          account_name: string | null;
          iban: string | null;
          url: string | null;
          qr_path: string | null;
        }[];
        const qrPaths = methods.map((m) => m.qr_path).filter((x): x is string => Boolean(x));
        const signed = qrPaths.length
          ? (await createServiceClient().storage.from("payout-qr").createSignedUrls(qrPaths, 60 * 60)).data ?? []
          : [];
        const signedByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
        const purchaserName = fundingRow.purchaser_id ? nameOf(fundingRow.purchaser_id) : "the organizer";
        pledge = {
          tripId,
          elementId: element.id,
          fundingRequestId: fundingRow.id,
          currentUserId: user.id,
          currency: fundingRow.currency ?? String(optionValue.currency ?? "EUR"),
          share: Number(fundingRow.individual_amount ?? fundingRow.required_amount),
          required: Number(fundingRow.required_amount),
          payTiming: fundingRow.pay_timing,
          windowHours: fundingRow.pay_window_hours,
          windowOpenedAt: fundingRow.pay_window_opened_at,
          windowClosed: fundingRow.pay_window_opened_at && fundingRow.pay_window_hours != null
            ? new Date(fundingRow.pay_window_opened_at).getTime() + fundingRow.pay_window_hours * 3_600_000 <= new Date().getTime()
            : false,
          canManage: Boolean(canManage),
          collectorId: fundingRow.purchaser_id,
          collectorName: purchaserName === "You" ? (rosterById.get(user.id)?.display_name?.trim() || "you") : purchaserName,
          population: Number(population ?? 0),
          pledges,
          notPledged: canManage
            ? scopedParticipants.filter((s) => !pledgedIds.has(s.userId)).map((s) => ({ userId: s.userId, displayName: s.displayName }))
            : [],
          myInElement: scopedParticipants.some((s) => s.userId === user.id),
          mySpotsFull: Boolean(mySpotsFull),
          payoutMethods: methods.map((m) => ({
            id: m.id,
            kind: m.kind,
            label: m.label,
            accountName: m.account_name,
            iban: m.iban,
            url: m.url,
            qrUrl: m.qr_path ? (signedByPath.get(m.qr_path) ?? null) : null,
          })),
        };
      }

      // Flow #4: mandate-based payments, only where Stripe (test mode) is
      // configured AND this request collects through Catoco — elsewhere the
      // card shows the pledge flow (or the manual ledger locally).
      if (stripeConfigured() && collectionMode === "catoco_psp") {
        // RLS scopes these: the organizer reads every mandate on the
        // request, a participant only their own. Contributions are visible
        // to all members (existing policy).
        const [
          { data: mandateRows },
          { data: summaryRows },
          { data: contributionRows },
          { data: spotsFull },
          { data: capAmount },
          { data: retryRows },
          { data: cushionAllowed },
          { data: withdrawalRows },
          { data: recalcRow },
          { data: groupSplit },
        ] = await Promise.all([
          supabase
            .from("funding_mandates")
            .select("id, participant_id, status, payment_method_type, failure_reason, created_at, max_amount, retry_reason")
            .eq("funding_request_id", fundingRow.id)
            .order("created_at", { ascending: false })
            .returns<MandateRow[]>(),
          supabase.rpc("get_funding_mandate_summary", { p_funding_request_id: fundingRow.id }),
          supabase
            .from("funding_contributions")
            .select("contributor_id, source, amount, platform_fee, payment_method_type, refunded_at, stripe_refund_id, created_at")
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
          // After-commit pass (2026-10-14): the per-participant cushion is
          // offered only for vendor-sourced prices with the trip setting on;
          // withdrawals pause Commit until the organizer recalculates.
          // Each degrades to "off" where the migration isn't applied yet.
          supabase.rpc("funding_request_cushion_allowed", { p_funding_request_id: fundingRow.id }),
          supabase.rpc("get_funding_withdrawals", { p_funding_request_id: fundingRow.id }),
          supabase.from("funding_requests").select("shares_recalculated_at").eq("id", fundingRow.id).maybeSingle(),
          supabase.rpc("funding_request_is_group_split", { p_funding_request_id: fundingRow.id }),
        ]);
        const allWithdrawals = (withdrawalRows ?? []) as { participant_id: string; display_name: string | null; withdrawn_at?: string | null }[];
        // Recalculated automatically if the organizer doesn't act (founder, 2026-10-14).
        const firstWithdrawnAt =
          allWithdrawals
            .map((w) => w.withdrawn_at)
            .filter((t): t is string => Boolean(t))
            .sort()[0] ?? null;
        const recalcAt = autoRecalcAt(firstWithdrawnAt, fundingRow.funding_deadline);
        const withdrawals = allWithdrawals.filter(
          (w) => w.participant_id !== user.id,
        );
        const sharesRecalculatedAt = (recalcRow as { shares_recalculated_at: string | null } | null)?.shares_recalculated_at ?? null;
        const retryRow = (Array.isArray(retryRows) ? retryRows[0] : retryRows) as
          | { waiting: number; held: number; total: number; retry_deadline: string | null; hold_cap_at: string | null }
          | null
          | undefined;
        const summary = (Array.isArray(summaryRows) ? summaryRows[0] : summaryRows) as
          | { population: number; covered: number }
          | undefined;
        // Estimated re-split if the organizer recalculates for the people still in.
        const withdrawalEstimate =
          withdrawals.length > 0 && summary
            ? (() => {
                const remaining = Math.max(0, summary.population - withdrawals.length);
                const required = Number(fundingRow.required_amount);
                const newShare =
                  option?.pricing_basis === "per_person" || remaining === 0
                    ? Number(fundingRow.individual_amount ?? required)
                    : Math.round((required / remaining) * 100) / 100;
                return { remaining, newShare };
              })()
            : null;
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
            if (m.status === "charge_failed") detail = m.failure_reason;
            if (m.status === "canceled") {
              // Stored reasons are matched elsewhere; show plain wording here.
              const r = m.failure_reason ?? "";
              detail = r === "canceled by participant"
                ? "not participating"
                : r.startsWith("shares changed")
                  ? "needs to recommit (shares changed)"
                  : r.startsWith("price rose")
                    ? "needs to recommit (price rose)"
                    : r || null;
            }
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
            cushionAllowed: cushionAllowed === true,
            recommendedCushion: recommendedCushion(
              element.cushion_kind ?? cushionTrip?.price_cushion_kind,
              element.cushion_kind ? element.cushion_value : cushionTrip?.price_cushion_value,
            ),
            groupSplit: groupSplit !== false,
            sharesMayChange: withdrawals.length > 0,
            sharesRecalculatedAt,
            withdrawalEstimate,
            autoRecalcAt: recalcAt,
            notParticipating: !scopedParticipants.some((p) => p.userId === user.id),
          },
          withdrawals:
            isOrganizerView && withdrawalEstimate && summary
              ? {
                  names: withdrawals.map((w) => w.display_name?.trim() || "Someone"),
                  ...withdrawalEstimate,
                  currentShare: Number(fundingRow.individual_amount ?? fundingRow.required_amount),
                  autoRecalcAt: recalcAt,
                  population: summary.population,
                }
              : null,
          roster: paymentRoster,
          isOrganizerView,
          // Refunds return the whole charge, Catoco fee included.
          heldAmount: held.reduce((sum, c) => sum + Number(c.amount) + Number(c.platform_fee ?? 0), 0),
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
    // Booking record (RLS: element participants + organizers + purchaser).
    const [{ data: bookingRow }, { data: canEditBookingData }, { data: inboundRows }] = await Promise.all([
      supabase.from("element_bookings").select("*").eq("element_id", element.id).maybeSingle(),
      supabase.rpc("can_edit_element_booking", { p_element_id: element.id }),
      supabase
        .from("inbound_booking_emails")
        .select("from_address, subject, received_at, status")
        .eq("element_id", element.id)
        .eq("status", "parsed")
        .order("received_at", { ascending: false })
        .limit(1),
    ]);
    const canEditBooking = Boolean(canEditBookingData);
    const booking = bookingRow as (BookingRecordView & { document_path: string | null; lead_booker_id: string | null }) | null;
    let bookingDocument: { url: string; isPdf: boolean } | null = null;
    if (booking?.document_path) {
      const { data: signed } = await createServiceClient()
        .storage.from(CONFIRMATION_BUCKET)
        .createSignedUrl(booking.document_path, 600);
      if (signed?.signedUrl) {
        bookingDocument = { url: signed.signedUrl, isPdf: booking.document_path.toLowerCase().endsWith(".pdf") };
      }
    }
    const leadRow = booking?.lead_booker_id ? rosterById.get(booking.lead_booker_id) : undefined;
    // get_trip_roster already blanks other names when "View all participants" is off.
    const bookingLeadName = leadRow?.display_name?.trim() || null;
    const toLocal = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
    const optionValue = (option?.value ?? {}) as Record<string, unknown>;
    const pendingEmail = (inboundRows ?? [])[0] as { from_address: string; subject: string; received_at: string } | undefined;
    const bookingDraft: BookingDraft = {
      vendor: booking?.vendor ?? String(optionValue.title ?? optionValue.name ?? ""),
      confirmation_ref: booking?.confirmation_ref ?? "",
      starts_at: toLocal(booking?.starts_at),
      ends_at: toLocal(booking?.ends_at),
      address: booking?.address ?? "",
      checkin_instructions: booking?.checkin_instructions ?? "",
      cancellation_deadline: toLocal(booking?.cancellation_deadline),
      cancellation_policy: booking?.cancellation_policy ?? "",
      notes: booking?.notes ?? "",
      lead_booker_id: booking?.lead_booker_id ?? fundingRow?.purchaser_id ?? user.id,
      amount_charged: booking?.amount_charged != null ? String(booking.amount_charged) : "",
      currency: booking?.currency ?? fundingRow?.currency ?? String(optionValue.currency ?? ""),
      documentName: booking?.document_path ? booking.document_path.split("/").pop() ?? null : null,
      field_provenance: booking?.field_provenance ?? {},
      pendingEmail: pendingEmail && !booking?.confirmed_at
        ? { from: pendingEmail.from_address, subject: pendingEmail.subject, receivedAt: pendingEmail.received_at }
        : null,
      source: (booking?.source as BookingDraft["source"]) ?? "manual",
    };
    const bookingRoster = roster.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name?.trim() || (r.is_organizer ? "Organizer" : "Member"),
    }));
    const showIncidentals = element.type === "accommodation";

    // Traveler details (commit step): what this element's vendor needs, and
    // whether the viewer still owes them. Read with the service role — the
    // table is ciphertext with no RLS policies; the viewer only ever gets
    // their OWN details back here.
    const travelerService = createServiceClient();
    const travelerInfo = fundingRow ? await elementRequirement(travelerService, element.id) : null;
    const travelerReq = travelerCryptoConfigured() ? (travelerInfo?.req ?? null) : null;
    let myTraveler: { initial: TravelerDetails; complete: boolean } | null = null;
    if (travelerReq && travelerInfo && (await requirementAppliesTo(travelerService, element.id, travelerInfo.tripId, travelerReq, user.id))) {
      const { data: mine } = await travelerService
        .from("element_traveler_details")
        .select("data_enc")
        .eq("element_id", element.id)
        .eq("participant_id", user.id)
        .maybeSingle();
      myTraveler = {
        initial: mine?.data_enc ? decryptJson<TravelerDetails>(mine.data_enc) : {},
        complete: await hasCompleteDetails(travelerService, element.id, user.id, travelerReq),
      };
    }
    // Organizer/purchaser view: how many have added what the vendor needs.
    const travelerProgress =
      canEditBooking && travelerReq && travelerInfo && fundingRow?.status === "collecting"
        ? await travelerDetailsProgress(travelerService, element.id, travelerInfo.tripId, travelerReq)
        : null;
    const automaticBooking = isAutomaticBooking(optionValue);
    // A trip member who isn't on this element can take a spot someone
    // withdrew from (founder, 2026-10-14) — they can't read its funding, so ask.
    const openSpotRows =
      !element.booked_at && !scopedParticipants.some((p) => p.userId === user.id)
        ? (await supabase.rpc("get_element_open_spot", { p_element_id: element.id })).data
        : null;
    const openSpot = ((openSpotRows ?? []) as {
      funding_request_id: string;
      open_spots: number;
      individual_amount: number;
      currency: string | null;
    }[])[0];
    const bookerRow = fundingRow?.purchaser_id ? rosterById.get(fundingRow.purchaser_id) : undefined;
    const bookerName = bookerRow?.display_name?.trim() || "the organizer";

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

    const lockedTitle = option ? optionTitleOf(element.type, option.value as Record<string, unknown>) : null;
    const collecting = funding?.status === "collecting";
    // "Waiting on you": you're in this element and haven't committed yet.
    const myMandateStatus = payments?.panel.myMandate?.status ?? "";
    const waitingOnYou = Boolean(
      collecting &&
        payments &&
        !funding?.chargeStatus &&
        scopedParticipants.some((p) => p.userId === user.id) &&
        !["active", "charging", "held", "awaiting_retry", "charge_succeeded"].includes(myMandateStatus) &&
        !payments.panel.alreadyContributed &&
        !payments.panel.waitlisted,
    );

    // "⋯" menu per stage (founder, 2026-10-14) — Collecting: Edit element ·
    // Set a new deadline · Nudge · Traveler details…; Committing: Final
    // nudge (+24h) only; Booked (manual): Edit booking record.
    const committingPhase = collecting && funding?.chargeStatus === "charging";
    const headerDialogs: HeaderDialog[] = [];
    const readyToBook = funding?.status === "ready_to_purchase";
    if (((collecting && !committingPhase) || readyToBook) && canEditBooking && travelerCryptoConfigured() && !automaticBooking) {
      headerDialogs.push({
        key: "traveler-details",
        text: "Traveler details…",
        title: "Traveler details",
        subtitle: "What the vendor needs to book",
        content: <TravelerRequirementEditor tripId={tripId} elementId={element.id} requirement={travelerInfo?.req ?? null} />,
      });
    }
    if (booking?.confirmed_at && canEditBooking && booking.source !== "api") {
      headerDialogs.push({
        key: "booking-record",
        text: "Edit booking record",
        title: "Edit booking record",
        content: (
          <BookingRecordForm
            tripId={tripId}
            elementId={element.id}
            draft={bookingDraft}
            roster={bookingRoster}
            mode="edit"
            amountFromCard={null}
            showIncidentals={false}
          />
        ),
      });
    }

    body = (
      <ElementPageUIProvider>
        <div className="flex w-full max-w-xl flex-col gap-3.5 text-left">
          <section
            className={`flex flex-col gap-3 rounded-[18px] border-[1.5px] bg-brand-surface p-4 sm:px-[18px] ${
              collecting ? "border-brand-teal-deep" : "border-brand-line"
            }`}
          >
            <ElementHeader
              tripId={tripId}
              elementId={element.id}
              symbol={ELEMENT_SYMBOLS[element.type]}
              label={element.label}
              subtitle={lockedTitle}
              chip={{
                text:
                  collecting && funding?.chargeStatus === "charging"
                    ? "Committing"
                    : collecting
                      ? "Ready to fund"
                      : funding?.status === "ready_to_purchase"
                        ? automaticBooking
                          ? "Funded · booking now"
                          : canEditBooking
                            ? "Funded · ready to book"
                            : "Funded"
                        : status.statusLabel,
              }}
              deadlineLabel={collecting ? deadlineLabelFor("funding", funding?.deadline) : null}
              waitingOnYou={waitingOnYou}
              edit={
                canEdit && !element.booked_at && !committingPhase
                  ? {
                      tripId,
                      elementId: element.id,
                      type: element.type,
                      state: "locked",
                      initialLabel: element.label,
                      initialMetadata: element.metadata ?? {},
                      initialOptionsDeadline: null,
                      initialVotingDeadline: null,
                      initialLockedValue: option?.value ?? {},
                      canSetSpots: Boolean(canManage) && element.type !== "dates" && element.type !== "destination",
                      initialSpots: element.spots,
                      initialCushionKind: element.cushion_kind,
                      initialCushionValue: element.cushion_value,
                      cushionEnabled: checkoutCushion,
                    }
                  : null
              }
              deadlineAction={canManage && collecting && !committingPhase ? "funding" : null}
              nudge={canManage && !committingPhase && nudgeTargets.length > 0 ? { count: nudgeTargets.length, phaseLabel: nudgePhase } : null}
              finalNudge={canManage && committingPhase && funding ? { fundingRequestId: funding.id } : null}
              dialogs={headerDialogs}
            />
            <MetadataLine type={element.type} metadata={element.metadata} />
            {travelerProgress && travelerProgress.total > 0 && (
              <p className="text-xs text-brand-muted">
                {travelerProgress.scope === "lead"
                  ? `Lead guest details: ${travelerProgress.added > 0 ? "added" : "not added yet"}`
                  : `Traveler details: ${travelerProgress.added} of ${travelerProgress.total} added`}
              </p>
            )}
            {booking?.confirmed_at && (
              <BookingRecord
                record={booking}
                document={bookingDocument}
                leadName={bookingLeadName}
                showIncidentals={showIncidentals}
              />
            )}
  
          {/* Booked elements normally drop the funding card — except when
              real Stripe payments back it: everyone's "used for booking"
              status and the Refund everyone path (a cancelled booking) have
              to stay reachable. */}
          {openSpot && (
            <OpenSpotCard
              tripId={tripId}
              elementId={element.id}
              fundingRequestId={openSpot.funding_request_id}
              share={Number(openSpot.individual_amount)}
              currency={openSpot.currency ?? "USD"}
              openSpots={openSpot.open_spots}
            />
          )}
          {(!element.booked_at || (funding && payments)) &&
            (funding ? (
              <I18nProvider locale={locale}>
              <MaybeTravelerGate
                gate={
                  funding.status === "collecting" && travelerReq && myTraveler
                    ? { requirement: travelerReq, initial: myTraveler.initial, complete: myTraveler.complete }
                    : null
                }
                tripId={tripId}
                elementId={element.id}
                bookerName={bookerName}
              >
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
                elementLabel={element.label}
                optionTitle={lockedTitle ?? undefined}
                payments={payments}
                collection={collection}
                pledge={pledge}
                priceInfo={priceInfo}
                booking={
                  canEditBooking
                    ? {
                        draft: bookingDraft,
                        roster: bookingRoster,
                        showIncidentals,
                        amountFromCard: null,
                        alreadyBooked: Boolean(booking?.confirmed_at && element.booked_at),
                        optionValue,
                        travelers: travelerReq ? <TravelerDetailsReveal elementId={element.id} /> : undefined,
                      }
                    : null
                }
              />
              </MaybeTravelerGate>
              </I18nProvider>
            ) : (
              // Dates/Destination are never price-bearing, so `funding` is
              // always null for them too — that's not "locked but missing a
              // funding request," there's nothing to book at all for these
              // two types.
              canEditBooking &&
              PRICE_BEARING_TYPES.includes(element.type) &&
              !element.booked_at && (
                <div className="mt-3 rounded-lg border border-brand-line p-3">
                  <span className="text-xs font-medium text-black dark:text-zinc-50">Record the booking</span>
                  <div className="mt-2">
                    <BookingRecordForm
                      tripId={tripId}
                      elementId={element.id}
                      draft={bookingDraft}
                      roster={bookingRoster}
                      mode="purchase"
                      amountFromCard={null}
                      showIncidentals={showIncidentals}
                    />
                  </div>
                </div>
              )
            ))}
  
          </section>

          {option && (
            <details className={detailsClass}>
              <summary className={summaryClass}>
                <span>Details</span>
                <span className="flex min-w-0 items-center gap-2.5 font-[family-name:var(--font-sans)] text-[13px] font-medium text-brand-muted">
                  <span className="truncate group-open:hidden">
                    {snapshotSummary(element.type, option.value as Record<string, unknown>, scopedParticipants.length)}
                  </span>
                  <DetailsChevron />
                </span>
              </summary>
              <div className="px-4 pb-4 sm:px-[18px]">
                <BookingSnapshot
                  type={element.type}
                  value={option.value}
                  participants={scopedParticipants}
                  pricing={snapshotPricing}
                  image={enrichment?.image}
                  details={enrichment?.details ?? readDetails(option.value as Record<string, unknown>)}
                  photoControl={
                    canEdit && element.type === "destination" ? (
                      <ChangePhoto
                        tripId={tripId}
                        elementId={element.id}
                        candidates={enrichment?.details?.images ?? []}
                        defaultQuery={
                          String(
                            (option.value as Record<string, unknown>).name ??
                              (option.value as Record<string, unknown>).title ??
                              element.label,
                          ).split(",")[0]
                        }
                      />
                    ) : undefined
                  }
                />
              </div>
            </details>
          )}
        </div>
      </ElementPageUIProvider>
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

    // "Who's invited" (founder, 2026-10-19). Organizers see the whole
    // roster, including trip members who aren't in scope (so they can add
    // them). Participants get get_element_invitees(): everyone when the
    // trip shows its list, the people on this element when "see who's on
    // the same element" is on, else only themselves.
    const [{ data: scopeRows }, { data: scopeRoster }, { data: invitees }] = await Promise.all([
      supabase
        .from("element_participants")
        .select("participant_id, opted_in")
        .eq("element_id", element.id)
        .returns<{ participant_id: string; opted_in: boolean }[]>(),
      canManage ? supabase.rpc("get_trip_roster", { p_trip_id: tripId }) : Promise.resolve({ data: null }),
      canManage ? Promise.resolve({ data: null }) : supabase.rpc("get_element_invitees", { p_element_id: element.id }),
    ]);
    const optedInById = new Map((scopeRows ?? []).map((r) => [r.participant_id, r.opted_in]));
    const scopeMembers: ScopeMember[] = canManage
      ? ((scopeRoster ?? []) as RosterRow[]).map((r) => ({
          userId: r.user_id,
          displayName: r.display_name?.trim() || (r.is_organizer ? "Organizer" : "Member"),
          optedIn: optedInById.has(r.user_id) ? optedInById.get(r.user_id)! : null,
        }))
      : ((invitees ?? []) as { user_id: string; display_name: string | null; opted_in: boolean }[]).map((r) => ({
          userId: r.user_id,
          displayName: r.display_name?.trim() || "Member",
          optedIn: r.opted_in,
        }));
    const guestListHidden = !canManage && !scopeMembers.some((m) => m.userId !== user.id);
    // Waitlists off (trip setting, 2026-10-19): a full element takes nobody else in.
    const [{ data: waitlistRow }, { data: spotsLimit }] = await Promise.all([
      supabase.from("trips").select("allow_element_waitlist").eq("id", tripId).maybeSingle(),
      supabase.rpc("element_spots", { p_element_id: element.id }),
    ]);
    const scopeInCount = (scopeRows ?? []).filter((r) => r.opted_in).length;
    const fullSpots =
      waitlistRow?.allow_element_waitlist === false && typeof spotsLimit === "number" && scopeInCount >= spotsLimit
        ? spotsLimit
        : null;
    const iOptedOut = optedInById.get(user.id) === false;

    // Lock it in: organizers/co-organizers, or whoever added the element
    // when the trip lets participants add their own (founder, 2026-10-14) —
    // lock_element() enforces the same rule; nobody else sees the button.
    const [{ data: lockSettings }, { data: voteSummary }] = await Promise.all([
      supabase.from("trips").select("allow_participant_elements").eq("id", tripId).maybeSingle(),
      // Counts only — votes stay private (no names).
      supabase.rpc("get_element_vote_summary", { p_element_id: element.id }),
    ]);
    const creatorCanLock = Boolean(lockSettings?.allow_participant_elements) && element.created_by === user.id;
    const summaryRows = (voteSummary ?? []) as {
      option_id: string;
      votes: number;
      voters: number;
      eligible: number;
      /** only when the trip's "Show who voted" setting is on */
      voter_initials: string[] | null;
    }[];
    const votesByOption = new Map(summaryRows.map((r) => [r.option_id, r.votes]));
    const initialsByOption = new Map(summaryRows.map((r) => [r.option_id, r.voter_initials]));


    // §11 phase gate: propose and rank never show at once. Before the
    // submission deadline, options are visible but not yet rankable; once
    // it passes, submissions close and only the ranking view remains, all
    // the way through to lock-in. Deadlines are now mandatory at creation
    // (§1/§2), so every open element has a clean, unambiguous point to gate
    // on — no manual "close submissions" step needed.
    const stillSubmitting =
      !element.options_deadline || new Date(element.options_deadline) > new Date();

    // The leading option (most votes, no tie) — its details stay open while voting.
    const byVotes = [...(options ?? [])].sort((a, b) => (votesByOption.get(b.id) ?? 0) - (votesByOption.get(a.id) ?? 0));
    const topVotes = byVotes[0] ? (votesByOption.get(byVotes[0].id) ?? 0) : 0;
    const leader =
      topVotes > 0 && (!byVotes[1] || (votesByOption.get(byVotes[1].id) ?? 0) < topVotes) ? byVotes[0] : null;

    body = (
      // Voting: the Trip Home column width (672px), per the voting mockup.
      <div className="flex w-full max-w-2xl flex-col gap-3.5 text-left">
        <section className="flex flex-col gap-3 rounded-[18px] border-[1.5px] border-dashed border-brand-teal bg-brand-surface p-4 sm:px-[18px]">
          <ElementHeader
            tripId={tripId}
            elementId={element.id}
            symbol={ELEMENT_SYMBOLS[element.type]}
            label={element.label}
            subtitle={leader ? optionTitleOf(element.type, leader.value) : null}
            chip={{ text: stillSubmitting ? "Open for options" : "Open for voting", dashed: true }}
            deadlineLabel={
              stillSubmitting
                ? deadlineLabelFor("submission", element.options_deadline)
                : deadlineLabelFor("voting", element.voting_deadline)
            }
            edit={
              canEdit
                ? {
                    tripId,
                    elementId: element.id,
                    type: element.type,
                    state: "open",
                    initialLabel: element.label,
                    initialMetadata: element.metadata ?? {},
                    initialOptionsDeadline: element.options_deadline,
                    initialVotingDeadline: element.voting_deadline,
                    initialLockedValue: null,
                    canSetSpots: Boolean(canManage) && element.type !== "dates" && element.type !== "destination",
                    initialSpots: element.spots,
                    initialCushionKind: element.cushion_kind,
                    initialCushionValue: element.cushion_value,
                  }
                : null
            }
            deadlineAction={canManage ? "edit" : null}
            nudge={canManage && nudgeTargets.length > 0 ? { count: nudgeTargets.length, phaseLabel: nudgePhase } : null}
            chipAction={
              optedInById.has(user.id) ? (
                <OptOutButton
                  tripId={tripId}
                  elementId={element.id}
                  optedIn={optedInById.get(user.id) === true}
                  full={fullSpots !== null}
                />
              ) : null
            }
          />
          <MetadataLine type={element.type} metadata={element.metadata} />
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
            // Element members can read every scope row, so the count is real
            // even when the names are hidden.
            inCount={scopeInCount}
            fullSpots={fullSpots}
            // Only themselves visible while others are in: say the list is hidden.
            guestListHidden={guestListHidden && (scopeRows ?? []).filter((r) => r.opted_in).length > 1}
          />
  
  
          <div className="flex flex-col gap-2">
            {(options ?? []).length > 0 ? (
              <VotingSection
                tripId={tripId}
                elementId={element.id}
                elementType={element.type}
                options={(options ?? []).map((o) => ({
                  id: o.id,
                  value: o.value,
                  score: scoresByOption.get(o.id) ?? 0,
                  votes: votesByOption.get(o.id) ?? 0,
                  voterInitials: initialsByOption.get(o.id) ?? null,
                  proposedBy: o.proposed_by,
                }))}
                symbol={ELEMENT_SYMBOLS[element.type]}
                elementLabel={element.label}
                voters={summaryRows[0]?.voters ?? 0}
                eligible={summaryRows[0]?.eligible ?? 0}
                myRanking={myRanking}
                votingDeadline={element.voting_deadline}
                currentUserId={user.id}
                canManage={Boolean(canManage)}
                canLockAny={creatorCanLock}
                readOnly={stillSubmitting || iOptedOut}
                tripNights={tripContext.dates?.nights ?? null}
                hideHeader
              />
            ) : (
              <p className="text-xs text-brand-muted">No options yet.</p>
            )}
  
            </div>
        </section>

        {leader && (
          <details open className={detailsClass}>
            <summary className={summaryClass}>
              <span>Details</span>
              <DetailsChevron />
            </summary>
            <div className="px-4 pb-4 sm:px-[18px]">
              <BookingSnapshot
                type={element.type}
                value={leader.value}
                // "Who's invited" above already lists the people (founder, 2026-10-19).
                participants={[]}
                hidePeople
                details={readDetails(leader.value)}
              />
            </div>
          </details>
        )}

        {stillSubmitting && !iOptedOut && (
          <SubmitOptionForm elementId={element.id} type={element.type} tripContext={tripContext} />
        )}
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
    </div>
  );
}
