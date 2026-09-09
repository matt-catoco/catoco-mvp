"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElementValueFields } from "@/components/element-value-fields";
import { ElementMetadataFields } from "@/components/element-metadata-fields";
import {
  ELEMENT_LABELS,
  ELEMENT_TYPES,
  applyTripContext,
  emptyMetadataFor,
  emptyValueFor,
  validateOptionValue,
  type ElementType,
  type TripContext,
} from "@/lib/trip-elements";
import { createElement } from "./actions";
import { btnPrimary, fieldClass, labelClass, pillActiveTeal, pillInactive } from "@/lib/ui";
import { VendorSearchPanel, VENDOR_SEARCHABLE_TYPES } from "./vendor-search-modal";

const field = `h-10 ${fieldClass}`;

type RosterEntry = { userId: string; displayName: string; isOrganizer: boolean };

/**
 * Everything a chained element after the first inherits from the anchor —
 * scope, deadlines, currency, pricing basis (§2 of the chain-at-creation
 * prompt) — carried client-side from whichever element was just submitted
 * into the next one's defaults, since chaining only ever happens within
 * one continuous overlay session (no bundle_groups table, no server round
 * trip needed to look this back up).
 */
export type BundleContext = {
  anchorId: string;
  scopeMode: "everyone" | "custom";
  customScope: string[];
  optionsDeadline: string;
  votingDeadline: string;
  currency: string;
  pricingBasis: string;
};

/**
 * Any trip member can add an element — scoped to everyone, or a hand-picked
 * subset of the roster (e.g. 3 friends splitting airfare). Locking
 * immediately is only offered when the current scope selection actually
 * qualifies (organizer, or a solo scope of just the creator) — the server
 * enforces the same rule regardless, this just avoids offering a choice
 * it'll silently override.
 *
 * Bundling ("Add element & bundle another") is organizer-only, same gate as
 * locking and custom scope — a bundle's fixed-split funding only really
 * means anything for locked, priced elements, and every field it shares
 * across members (scope included) is already organizer-only to set.
 */
export function AddElementForm({
  tripId,
  currentUserId,
  isOrganizer,
  roster,
  tripContext,
  bundleContext = null,
  // Default no-ops rather than required: the standalone /add-element page
  // is a Server Component (a direct-visit fallback, no overlay to keep
  // open) and can't pass an inline function prop across the server/client
  // boundary to this component, so it just omits both and relies on these
  // defaults instead of supplying dead callbacks.
  onChainedSubmit = () => {},
  onFinalSubmit = () => {},
  allowBundling = true,
}: {
  tripId: string;
  currentUserId: string;
  isOrganizer: boolean;
  roster: RosterEntry[];
  tripContext?: TripContext;
  // null for the first element of a (possible) bundle; set for every
  // element chained after it, pre-filling and locking the inherited fields.
  bundleContext?: BundleContext | null;
  // Called after "Add element & bundle another" succeeds — hands the parent
  // (AddElementModal) the snapshot the next chained element's form should
  // start from, and the overlay stays open for it.
  onChainedSubmit?: (next: BundleContext) => void;
  // Called after the plain "Add element" button succeeds — ends the chain
  // (if any) and the parent closes the overlay / navigates.
  onFinalSubmit?: (elementId: string) => void;
  // Chaining needs the overlay to stay open across multiple elements — the
  // standalone /add-element page (a plain full-page fallback for a direct
  // visit, no overlay to keep open) opts out rather than offering a link
  // with no sensible place to go.
  allowBundling?: boolean;
}) {
  const router = useRouter();
  const isChained = bundleContext !== null;
  const [type, setType] = useState<ElementType>("dates");
  const [label, setLabel] = useState(ELEMENT_LABELS.dates);
  const [labelTouched, setLabelTouched] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, string>>(() => emptyMetadataFor("dates"));
  const [scopeMode, setScopeMode] = useState<"everyone" | "custom">(bundleContext?.scopeMode ?? "everyone");
  const [customScope, setCustomScope] = useState<Set<string>>(
    () => new Set(bundleContext?.customScope ?? [currentUserId]),
  );
  const [state, setState] = useState<"open" | "locked">("open");
  const [lockedValue, setLockedValue] = useState<Record<string, unknown>>(() => {
    const base = applyTripContext("dates", emptyValueFor("dates"), tripContext);
    if (bundleContext) {
      return { ...base, currency: bundleContext.currency, pricing_basis: bundleContext.pricingBasis };
    }
    return base;
  });
  const [optionsDeadline, setOptionsDeadline] = useState(bundleContext?.optionsDeadline ?? "");
  const [votingDeadline, setVotingDeadline] = useState(bundleContext?.votingDeadline ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Locking a searchable type in now defaults to picking a real vendor
  // result instead of typing values in by hand — manual entry is a
  // fallback for whatever a search can't cover, one click away.
  const [manualEntry, setManualEntry] = useState(false);
  const isSearchable = VENDOR_SEARCHABLE_TYPES.includes(type);

  // Self-locking a solo-scoped element used to be reachable here too (scope
  // of exactly {you}), but a regular participant can no longer choose any
  // custom scope at all (organizer-only now, see the "Who's this for"
  // block below) -- only the organizer/co-organizer can lock at creation.
  const canLock = isOrganizer;
  const canBundle = isOrganizer && allowBundling;

  function onTypeChange(next: ElementType) {
    setType(next);
    if (!labelTouched) setLabel(ELEMENT_LABELS[next]);
    setMetadata(emptyMetadataFor(next));
    const base = applyTripContext(next, emptyValueFor(next), tripContext);
    setLockedValue(
      bundleContext
        ? { ...base, currency: bundleContext.currency, pricing_basis: bundleContext.pricingBasis }
        : base,
    );
    setManualEntry(false);
  }

  function toggleScopeMember(userId: string) {
    setCustomScope((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const lockDisabledReason = useMemo(() => {
    if (canLock) return null;
    return "Only the organizer can lock an element in immediately — everyone else's needs a vote.";
  }, [canLock]);

  function validate(): string | null {
    if (state === "locked") {
      return validateOptionValue(type, lockedValue, { requireDates: false });
    }
    if (!isChained) {
      // §1: deadlines are required for every type now (only relevant when
      // open — a locked-at-creation element never has them at all). Chained
      // elements inherit theirs, already set and non-empty.
      if (!optionsDeadline) return "Pick a submission deadline.";
      if (!votingDeadline) return "Pick a voting deadline.";
    }
    return null;
  }

  function currentScopeUserIds(): string[] | null {
    return scopeMode === "everyone" ? null : Array.from(customScope);
  }

  function nextBundleContext(anchorId: string): BundleContext {
    const priceValue = state === "locked" ? (lockedValue as Record<string, unknown>) : {};
    return {
      anchorId,
      scopeMode,
      customScope: Array.from(customScope),
      optionsDeadline,
      votingDeadline,
      currency: bundleContext?.currency ?? String(priceValue.currency ?? "USD"),
      pricingBasis: bundleContext?.pricingBasis ?? String(priceValue.pricing_basis ?? ""),
    };
  }

  function submitFinal() {
    const err = validate();
    if (err) return setError(err);
    setError(null);
    finalize(lockedValue);
  }

  function finalize(value: Record<string, unknown>) {
    startTransition(async () => {
      const res = await createElement({
        tripId,
        type,
        label,
        metadata,
        scopeUserIds: currentScopeUserIds(),
        state,
        optionsDeadline: optionsDeadline || null,
        votingDeadline: votingDeadline || null,
        lockedValue: state === "locked" ? value : undefined,
        bundleGroupId: bundleContext?.anchorId ?? null,
        startBundle: false,
        bundleContinues: false,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      onFinalSubmit(res.elementId!);
      router.push(`/trips/${tripId}/elements/${res.elementId}`);
    });
  }

  // A picked vendor result finalizes immediately — no separate "now click
  // Add element" step, matching Search options' existing post-creation
  // behavior. Currency/pricing basis still get forced to the bundle's
  // inherited values when chained, same rule as the manual Value form's
  // lockedPricing — a vendor's own price stays whatever it searched, but
  // those two fields can't quietly diverge from the rest of the bundle.
  function handleSearchSelect(value: Record<string, unknown>) {
    const finalValue = isChained
      ? { ...value, currency: bundleContext!.currency, pricing_basis: bundleContext!.pricingBasis }
      : value;
    setError(null);
    setLockedValue(finalValue);
    finalize(finalValue);
  }

  function submitAndBundleAnother() {
    const err = validate();
    if (err) return setError(err);
    setError(null);
    startTransition(async () => {
      const res = await createElement({
        tripId,
        type,
        label,
        metadata,
        scopeUserIds: currentScopeUserIds(),
        state,
        optionsDeadline: optionsDeadline || null,
        votingDeadline: votingDeadline || null,
        lockedValue: state === "locked" ? lockedValue : undefined,
        bundleGroupId: bundleContext?.anchorId ?? null,
        startBundle: !isChained,
        bundleContinues: true,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      const anchorId = bundleContext?.anchorId ?? res.elementId!;
      onChainedSubmit(nextBundleContext(anchorId));
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {isChained && (
        <p className="rounded-lg bg-brand-teal-wash px-3 py-2 text-xs text-brand-teal-deep">
          Bundling another element — scope, deadlines, currency, and pricing basis below are shared
          with the rest of the bundle and can't be changed here.
        </p>
      )}

      <div className="flex flex-col items-center gap-1.5">
        <span className={labelClass}>Type</span>
        <div className="flex flex-wrap justify-center gap-1.5">
          {ELEMENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTypeChange(t)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                type === t ? pillActiveTeal : pillInactive
              }`}
            >
              {ELEMENT_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Label</span>
        <input
          className={field}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setLabelTouched(true);
          }}
          placeholder={type === "dates" ? "e.g. Rome leg" : "e.g. Friday night dinner"}
        />
      </label>

      <ElementMetadataFields type={type} value={metadata} onChange={setMetadata} />

      {isChained ? (
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Who's this for</span>
          <p className="text-sm">
            {scopeMode === "everyone"
              ? "Everyone"
              : roster
                  .filter((r) => customScope.has(r.userId))
                  .map((r) => (r.userId === currentUserId ? `${r.displayName} (you)` : r.displayName))
                  .join(", ") || "—"}
          </p>
        </div>
      ) : isOrganizer ? (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>Who's this for</span>
          <div className="flex flex-wrap justify-center gap-1.5">
            {(["everyone", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setScopeMode(m)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  scopeMode === m ? pillActiveTeal : pillInactive
                }`}
              >
                {m === "everyone" ? "Everyone" : "Choose people"}
              </button>
            ))}
          </div>
          {scopeMode === "custom" && (
            <ul className="mt-1 flex flex-col gap-1">
              {roster.map((r) => (
                <li key={r.userId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={customScope.has(r.userId)}
                      onChange={() => toggleScopeMember(r.userId)}
                    />
                    {r.displayName}
                    {r.userId === currentUserId && " (you)"}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-brand-muted">
          Visible to everyone on the trip — only the organizer can scope an element to specific
          people.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className={`${labelClass} text-center`}>State</span>
        <div className="flex flex-wrap justify-center gap-1.5">
          <button
            type="button"
            onClick={() => setState("open")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              state === "open" ? pillActiveTeal : pillInactive
            }`}
          >
            Open for voting
          </button>
          <button
            type="button"
            disabled={!canLock}
            onClick={() => setState("locked")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              state === "locked" ? pillActiveTeal : pillInactive
            }`}
          >
            Lock it in now
          </button>
        </div>
        {lockDisabledReason && <p className="text-xs text-brand-muted">{lockDisabledReason}</p>}
      </div>

      {state === "locked" ? (
        <div className="rounded-lg border border-brand-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className={labelClass}>{isSearchable && !manualEntry ? "Search & select" : "Value"}</span>
            {isSearchable && (
              <button
                type="button"
                onClick={() => setManualEntry((v) => !v)}
                className="text-xs text-brand-teal-deep underline decoration-dotted underline-offset-4"
              >
                {manualEntry ? "Search instead" : "Enter it myself"}
              </button>
            )}
          </div>
          {isSearchable && !manualEntry ? (
            <VendorSearchPanel
              elementType={type}
              tripContext={tripContext}
              onSelect={handleSearchSelect}
              selecting={pending}
            />
          ) : (
            <ElementValueFields
              type={type}
              value={lockedValue}
              onChange={setLockedValue}
              requireDates={false}
              lockedPricing={isChained}
            />
          )}
        </div>
      ) : isChained ? (
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Deadlines</span>
          <p className="text-sm">
            Submission by {optionsDeadline || "—"} · Vote by {votingDeadline || "—"}
          </p>
        </div>
      ) : (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>
              Submission deadline <span className="text-red-500">*</span>
            </span>
            <input
              type="date"
              required
              className={field}
              value={optionsDeadline}
              onChange={(e) => setOptionsDeadline(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>
              Voting deadline <span className="text-red-500">*</span>
            </span>
            <input
              type="date"
              required
              className={field}
              value={votingDeadline}
              onChange={(e) => setVotingDeadline(e.target.value)}
            />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Search mode's own "Select" button on each result is the submit
          action there — picking a result finalizes immediately (see
          handleSearchSelect), so these buttons would just validate against
          whatever's left in lockedValue from before a search even ran.
          Chaining a search-sourced element also isn't wired up yet (every
          "Select" ends the chain, matching Search options' existing
          post-creation behavior) — a fast-follow, not this pass. */}
      {!(state === "locked" && isSearchable && !manualEntry) && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={submitFinal}
            disabled={pending || !label.trim() || (state === "open" && !isChained && (!optionsDeadline || !votingDeadline))}
            className={`px-4 py-2 text-sm ${btnPrimary}`}
          >
            {pending ? "Adding…" : "Add element"}
          </button>
          {canBundle && (
            <button
              type="button"
              onClick={submitAndBundleAnother}
              disabled={pending || !label.trim() || (state === "open" && !isChained && (!optionsDeadline || !votingDeadline))}
              className="text-sm font-medium text-brand-teal-deep underline decoration-dotted underline-offset-4 hover:text-brand-teal-deep/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add element & bundle another
            </button>
          )}
        </div>
      )}
    </div>
  );
}
