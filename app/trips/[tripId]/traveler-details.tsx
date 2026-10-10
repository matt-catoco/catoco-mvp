"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";
import {
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

/** Commit step: the caller's own details for this element. */
export function TravelerDetailsForm({
  tripId,
  elementId,
  requirement,
  initial,
  complete,
  bookerName,
}: {
  tripId: string;
  elementId: string;
  requirement: TravelerRequirement;
  initial: TravelerDetails;
  complete: boolean;
  bookerName: string;
}) {
  const router = useRouter();
  const [d, setD] = useState<TravelerDetails>(initial);
  const [match, setMatch] = useState(complete);
  const [open, setOpen] = useState(!complete);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-line p-3 text-xs">
        <span>✓ Your traveler details are saved for booking.</span>
        <button type="button" className={`px-2.5 py-1 text-xs ${btnSecondary}`} onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-line p-3 text-xs">
      <span className="font-medium text-black dark:text-zinc-50">
        {requirement.scope === "lead" ? "Lead guest details" : "Your traveler details"} — needed before you commit
      </span>
      <span className="text-brand-muted">
        The vendor needs these to book. Only {bookerName}, the person booking, can see them — and only once everyone&apos;s
        money is in. Deleted {TRAVELER_DETAILS_RETENTION_DAYS} days after the trip.
      </span>
      <div className="grid gap-2 sm:grid-cols-2">
        {requirement.fields.map((f) => (
          <label key={f} className="flex flex-col gap-1">
            <span className={labelClass}>{TRAVELER_FIELD_LABEL[f]}</span>
            <input
              type={f === "date_of_birth" ? "date" : f === "email" ? "email" : "text"}
              className={`h-9 ${fieldClass}`}
              value={d[f] ?? ""}
              onChange={(e) => setD((p) => ({ ...p, [f]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={match} onChange={(e) => setMatch(e.target.checked)} />
        These match my passport / ID exactly
      </label>
      <button
        type="button"
        disabled={pending}
        className={`h-9 w-fit px-3 text-xs ${btnPrimary}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await saveMyTravelerDetails(tripId, elementId, d, match);
            if (res.error) return setError(res.error);
            setOpen(false);
            router.refresh();
          })
        }
      >
        {pending ? "Saving…" : "Save details"}
      </button>
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}

const EDITABLE: TravelerField[] = ["legal_first_name", "legal_last_name", "full_name", "date_of_birth", "email"];

/** Organizer/purchaser: what this vendor needs. We only ever collect name, DOB and email. */
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
          We only collect name, date of birth and email — never passport or ID numbers. If the vendor needs more, tell the
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
