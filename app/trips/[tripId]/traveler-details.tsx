"use client";

import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";
import {
  ALL_TRAVELER_FIELDS,
  GENDER_OPTIONS,
  TRAVELER_DETAILS_RETENTION_DAYS,
  TRAVELER_FIELD_LABEL,
  type TravelerDetails,
  type TravelerField,
  type TravelerRequirement,
} from "@/lib/traveler-fields";
import {
  loadTravelerDetailsForBooking,
  saveMyTravelerDetails,
  setTravelerRequirement,
  type TravelerBlock,
} from "./traveler-actions";

/**
 * Commit-step gate (founder, 2026-10-11): the traveler-details form opens as
 * an overlay when someone clicks "Authorize my share" / "Commit" without
 * their details saved, and the checkout carries on once they're in —
 * instead of the form sitting on the element page. The server still refuses
 * to commit without them (travelerDetailsOwed); this is the UX, not the guard.
 */
type Gate = {
  /** run `proceed` now if details are complete, else after they're saved */
  gate: (proceed: () => void) => void;
  /** open the form to edit saved details (no checkout afterwards) */
  edit: () => void;
  complete: boolean;
};

const GateContext = createContext<Gate | null>(null);

/** Commit buttons call this; outside a TravelerGate it just proceeds. */
export function useTravelerGate(): Gate {
  return useContext(GateContext) ?? { gate: (proceed) => proceed(), edit: () => {}, complete: true };
}

export function TravelerGate({
  tripId,
  elementId,
  requirement,
  initial,
  complete,
  bookerName,
  children,
}: {
  tripId: string;
  elementId: string;
  requirement: TravelerRequirement;
  initial: TravelerDetails;
  complete: boolean;
  bookerName: string;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState(complete);
  const [open, setOpen] = useState<null | { then?: () => void }>(null);

  const gate = useCallback(
    (proceed: () => void) => {
      if (saved) proceed();
      else setOpen({ then: proceed });
    },
    [saved],
  );
  const close = useCallback(() => setOpen(null), []);

  return (
    <GateContext.Provider value={{ gate, edit: () => setOpen({}), complete: saved }}>
      {children}
      {open && (
        <TravelerDetailsDialog
          tripId={tripId}
          elementId={elementId}
          requirement={requirement}
          initial={initial}
          alreadySaved={saved}
          bookerName={bookerName}
          continueLabel={open.then ? "Save and continue" : "Save details"}
          onClose={close}
          onSaved={() => {
            setSaved(true);
            const then = open.then;
            setOpen(null);
            then?.();
          }}
        />
      )}
    </GateContext.Provider>
  );
}

/** Small "details saved · Edit" line for the element page. */
export function TravelerDetailsStatus() {
  const { complete, edit } = useTravelerGate();
  if (!complete) return null;
  return (
    <p className="text-xs text-brand-muted">
      ✓ Your traveler details are saved for booking.{" "}
      <button type="button" className="font-medium text-brand-teal-deep underline" onClick={edit}>
        Edit
      </button>
    </p>
  );
}

function TravelerDetailsDialog({
  tripId,
  elementId,
  requirement,
  initial,
  alreadySaved,
  bookerName,
  continueLabel,
  onClose,
  onSaved,
}: {
  tripId: string;
  elementId: string;
  requirement: TravelerRequirement;
  initial: TravelerDetails;
  alreadySaved: boolean;
  bookerName: string;
  continueLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<TravelerDetails>(initial);
  const [match, setMatch] = useState(alreadySaved);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="traveler-dialog-title"
        className="mx-auto my-[8vh] flex w-full max-w-md flex-col gap-3 rounded-2xl border border-brand-line bg-background p-5 text-left text-xs shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="traveler-dialog-title" className="font-[family-name:var(--font-display)] text-lg font-bold text-foreground">
            {requirement.scope === "lead" ? "Lead guest details" : "Your traveler details"}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-lg leading-none text-brand-muted hover:text-foreground">
            ×
          </button>
        </div>
        <p className="text-brand-muted">
          The vendor needs these to book. Only {bookerName}, the person booking, can see them — and only once everyone&apos;s
          money is in. Deleted {TRAVELER_DETAILS_RETENTION_DAYS} days after the trip.
        </p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {requirement.fields.map((f) => (
            <label key={f} className="flex flex-col gap-1">
              <span className={labelClass}>{TRAVELER_FIELD_LABEL[f]}</span>
              {f === "gender" ? (
                <select
                  className={`h-9 ${fieldClass}`}
                  value={d.gender ?? ""}
                  onChange={(e) => setD((p) => ({ ...p, gender: e.target.value }))}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f === "date_of_birth" ? "date" : f === "email" ? "email" : f === "phone" ? "tel" : "text"}
                  autoComplete={f === "phone" ? "tel" : f === "email" ? "email" : undefined}
                  placeholder={f === "phone" ? "+44 7700 900123" : undefined}
                  className={`h-9 ${fieldClass}`}
                  value={d[f] ?? ""}
                  onChange={(e) => setD((p) => ({ ...p, [f]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={match} onChange={(e) => setMatch(e.target.checked)} />
          These match my passport / ID exactly
        </label>
        {error && <p className="text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={`h-9 px-3 text-xs ${btnSecondary}`} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            className={`h-9 px-3 text-xs ${btnPrimary}`}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await saveMyTravelerDetails(tripId, elementId, d, match);
                if (res.error) return setError(res.error);
                router.refresh();
                onSaved();
              })
            }
          >
            {pending ? "Saving…" : continueLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const EDITABLE = ALL_TRAVELER_FIELDS;

/** Organizer/purchaser: what this vendor needs. We only ever collect name, DOB, gender, email and phone. */
export function TravelerRequirementEditor({
  tripId,
  elementId,
  requirement,
}: {
  tripId: string;
  elementId: string;
  requirement: TravelerRequirement | null;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<TravelerRequirement["scope"]>(requirement?.scope ?? "lead");
  const [fields, setFields] = useState<Set<TravelerField>>(new Set(requirement?.fields ?? []));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="rounded-lg border border-brand-line p-3 text-xs">
      <summary className="cursor-pointer font-medium text-black dark:text-zinc-50">
        Details the vendor needs: {requirement ? `${requirement.fields.length} field${requirement.fields.length === 1 ? "" : "s"}, ${requirement.scope === "each" ? "every traveler" : "lead guest only"}` : "none"}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <span className="text-brand-muted">
          We only collect name, date of birth, gender, email and phone — never passport or ID numbers. If the vendor needs more, tell the
          Catoco team before adding it.
        </span>
        <div className="flex gap-3">
          {(["lead", "each"] as const).map((s) => (
            <label key={s} className="flex items-center gap-1.5">
              <input type="radio" checked={scope === s} onChange={() => setScope(s)} />
              {s === "lead" ? "Lead guest only" : "Every traveler"}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {EDITABLE.map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={fields.has(f)}
                onChange={(e) =>
                  setFields((prev) => {
                    const n = new Set(prev);
                    if (e.target.checked) n.add(f);
                    else n.delete(f);
                    return n;
                  })
                }
              />
              {TRAVELER_FIELD_LABEL[f].replace(/ \(.*\)$/, "")}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            className={`px-2.5 py-1 text-xs ${btnSecondary}`}
            onClick={() =>
              start(async () => {
                const res = await setTravelerRequirement(tripId, elementId, { scope, fields: [...fields] });
                setMsg(res.error ?? "Saved");
                if (!res.error) router.refresh();
              })
            }
          >
            Save
          </button>
          <button
            type="button"
            disabled={pending}
            className="text-brand-muted underline"
            onClick={() =>
              start(async () => {
                const res = await setTravelerRequirement(tripId, elementId, null);
                setMsg(res.error ?? "Back to the default for this type");
                if (!res.error) router.refresh();
              })
            }
          >
            Use the default
          </button>
          {msg && <span className="text-brand-muted">{msg}</span>}
        </div>
      </div>
    </details>
  );
}

/** Ready to Book: copy-ready blocks, loaded on demand (each view is logged). */
export function TravelerDetailsReveal({ elementId }: { elementId: string }) {
  const [blocks, setBlocks] = useState<TravelerBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!blocks) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={pending}
          className={`w-fit px-2.5 py-1 text-xs ${btnSecondary}`}
          onClick={() =>
            start(async () => {
              const res = await loadTravelerDetailsForBooking(elementId);
              if (res.error) setError(res.error);
              else setBlocks(res.travelers ?? []);
            })
          }
        >
          {pending ? "Loading…" : "Show traveler details"}
        </button>
        <span className="text-[11px] text-brand-muted">Each time you open these it&apos;s recorded.</span>
        {error && <span className="text-red-500">{error}</span>}
      </div>
    );
  }
  if (blocks.length === 0) return <span className="text-brand-muted">Nobody has added details yet.</span>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {blocks.map((b) => {
        const text = b.lines.map((l) => `${l.label}: ${l.value}`).join("\n");
        return (
          <div key={b.participantId} className="flex flex-col gap-1 rounded-md border border-brand-line p-2">
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{b.name}</span>
              <button
                type="button"
                className={`px-2 py-0.5 text-[11px] ${btnSecondary}`}
                onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(b.participantId))}
              >
                {copied === b.participantId ? "Copied" : "Copy"}
              </button>
            </span>
            {b.lines.map((l) => (
              <span key={l.label} className="flex justify-between gap-2">
                <span className="text-brand-muted">{l.label}</span>
                <span className="select-all font-medium">{l.value}</span>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
