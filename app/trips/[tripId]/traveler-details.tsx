"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
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
 * Commit-step traveler details (founder, 2026-10-11): collected in a
 * lightbox at the commit click instead of sitting on the element page. The
 * Stripe authorization runs in the same lightbox right after (MandatePanel);
 * the manual "Commit" path uses the gate's own dialog. The server still
 * refuses to commit without details (travelerDetailsOwed) — this is the UX,
 * not the guard.
 */
type GateConfig = {
  tripId: string;
  elementId: string;
  requirement: TravelerRequirement;
  initial: TravelerDetails;
  bookerName: string;
};

type Gate = {
  /** null outside a TravelerGate (element needs no details) */
  config: GateConfig | null;
  complete: boolean;
  markSaved: () => void;
  /** run `proceed` now if details are complete, else after they're saved (own dialog) */
  gate: (proceed: () => void) => void;
  /** open the form to edit saved details */
  edit: () => void;
};

const GateContext = createContext<Gate | null>(null);

export function useTravelerGate(): Gate {
  return (
    useContext(GateContext) ?? {
      config: null,
      complete: true,
      markSaved: () => {},
      gate: (proceed) => proceed(),
      edit: () => {},
    }
  );
}

export function TravelerGate({
  complete,
  children,
  ...config
}: GateConfig & { complete: boolean; children: ReactNode }) {
  const [saved, setSaved] = useState(complete);
  const [open, setOpen] = useState<null | { then?: () => void }>(null);
  const markSaved = useCallback(() => setSaved(true), []);
  const gate = useCallback(
    (proceed: () => void) => {
      if (saved) proceed();
      else setOpen({ then: proceed });
    },
    [saved],
  );
  const close = useCallback(() => setOpen(null), []);
  const value: Gate = { config, complete: saved, markSaved, gate, edit: () => setOpen({}) };

  return (
    <GateContext.Provider value={value}>
      {children}
      {open && (
        <Lightbox title={config.requirement.scope === "lead" ? "Lead guest details" : "Your traveler details"} onClose={close}>
          <TravelerDetailsFields
            submitLabel={open.then ? "Save and continue" : "Save details"}
            onCancel={close}
            onSaved={() => {
              const then = open.then;
              setOpen(null);
              then?.();
            }}
          />
        </Lightbox>
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

/** Centered overlay box used for the commit/checkout steps. */
export function Lightbox({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  /** one muted line under the title (e.g. "Accommodations · Casa Mare") */
  subtitle?: string;
  /** omit to make it non-dismissable (e.g. mid-payment) */
  onClose?: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Return focus to whatever opened the dialog (e.g. the Commit button) on
  // close; move focus into the dialog on open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (opener && document.body.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      // Focus trap: Tab / Shift-Tab wrap inside the dialog.
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={() => onClose?.()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightbox-title"
        className="mx-auto my-[8vh] flex w-full max-w-md flex-col gap-3 rounded-2xl border border-brand-line bg-background p-5 text-left text-xs shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="lightbox-title" className="font-[family-name:var(--font-display)] text-[22px] font-bold leading-tight text-foreground">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-brand-muted">{subtitle}</p>}
          </div>
          {onClose && (
            <button type="button" aria-label="Close" onClick={onClose} className="rounded-md text-lg leading-none text-brand-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-teal-deep focus-visible:ring-offset-2">
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The details form itself (no frame) — reads the element's config from the gate. */
export function TravelerDetailsFields({
  submitLabel,
  onSaved,
  onCancel,
}: {
  submitLabel: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { config, complete, markSaved } = useTravelerGate();
  const [d, setD] = useState<TravelerDetails>(config?.initial ?? {});
  const [match, setMatch] = useState(complete);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!config) return null;

  return (
    <>
      <p className="text-brand-muted">
        The vendor needs these to book. Only {config.bookerName}, the person booking, can see them — and only once
        everyone&apos;s money is in. Deleted {TRAVELER_DETAILS_RETENTION_DAYS} days after the trip.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {config.requirement.fields.map((f) => (
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
        <button type="button" className={`h-9 px-3 text-xs ${btnSecondary}`} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          className={`h-9 px-3 text-xs ${btnPrimary}`}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await saveMyTravelerDetails(config.tripId, config.elementId, d, match);
              if (res.error) return setError(res.error);
              markSaved();
              router.refresh();
              onSaved();
            })
          }
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </>
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
    // Lives in the header "⋯" menu → "Traveler details…" dialog.
    <div className="flex flex-col gap-2 text-xs">
      <p className="font-medium text-black dark:text-zinc-50">
        Details the vendor needs: {requirement ? `${requirement.fields.length} field${requirement.fields.length === 1 ? "" : "s"}, ${requirement.scope === "each" ? "every traveler" : "lead guest only"}` : "none"}
      </p>
      <div className="flex flex-col gap-2">
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
    </div>
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
