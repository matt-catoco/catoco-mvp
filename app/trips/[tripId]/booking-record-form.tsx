"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";
import { CONFIRMATION_BUCKET, CONFIRMATION_MAX_BYTES, CONFIRMATION_MIME_TYPES } from "@/lib/booking-confirmation";
import { prepareConfirmationUpload } from "./confirmation-actions";
import {
  getForwardingAddress,
  recordDeferredBooking,
  reportElementUnavailable,
  saveBookingRecord,
  type BookingRecordInput,
} from "./booking-actions";

/** What the form starts from: a saved draft (possibly extracted from a forwarded email). */
export type BookingDraft = {
  vendor: string;
  confirmation_ref: string;
  starts_at: string; // datetime-local
  ends_at: string;
  address: string;
  checkin_instructions: string;
  cancellation_deadline: string;
  cancellation_policy: string;
  notes: string;
  lead_booker_id: string;
  amount_charged: string;
  currency: string;
  documentName: string | null;
  field_provenance: Record<string, "extracted" | "entered">;
  /** a forwarded email is waiting for review */
  pendingEmail: { from: string; subject: string; receivedAt: string } | null;
  source: "email" | "upload" | "manual" | "api";
};

type TextKey = "vendor" | "confirmation_ref" | "address" | "checkin_instructions" | "cancellation_policy" | "notes";
type DateKey = "starts_at" | "ends_at" | "cancellation_deadline";

const TEXT_FIELDS: { key: TextKey; label: string; long?: boolean; placeholder?: string }[] = [
  { key: "vendor", label: "Vendor *", placeholder: "e.g. Hotel Artemide, Viator, Ryanair" },
  { key: "confirmation_ref", label: "Confirmation reference", placeholder: "Booking / reservation number" },
  { key: "address", label: "Address or meeting point" },
  { key: "checkin_instructions", label: "Check-in or meeting instructions", long: true },
  { key: "cancellation_policy", label: "Cancellation policy", long: true },
  { key: "notes", label: "Anything else the group should know", long: true },
];
const DATE_FIELDS: { key: DateKey; label: string }[] = [
  { key: "starts_at", label: "Starts" },
  { key: "ends_at", label: "Ends" },
  { key: "cancellation_deadline", label: "Free cancellation until" },
];

export function BookingRecordForm({
  tripId,
  elementId,
  draft,
  roster,
  mode,
  amountFromCard,
  showIncidentals,
}: {
  tripId: string;
  elementId: string;
  draft: BookingDraft;
  roster: { userId: string; displayName: string }[];
  /** purchase: confirm + mark Booked now. deferred: book now, pay later (funding still collecting). */
  mode: "purchase" | "deferred" | "edit";
  /** the Issuing card's captured amount — when known we never ask for it */
  amountFromCard: number | null;
  showIncidentals: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<BookingDraft>(draft);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [deferred, setDeferred] = useState({ timing: "pay_at_property" as "pay_later" | "pay_at_property", chargeStart: "", chargeEnd: "" });

  const set = (key: keyof BookingDraft, v: string) => {
    setF((p) => ({ ...p, [key]: v }));
    setTouched((t) => new Set(t).add(key));
  };
  const provenance = (key: string) => {
    if (touched.has(key)) return "entered";
    return f.field_provenance[key];
  };
  const Badge = ({ k }: { k: string }) =>
    provenance(k) === "extracted" ? (
      <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        from email — check it
      </span>
    ) : null;

  async function showAddress() {
    const res = await getForwardingAddress(elementId);
    if (res.error) setError(res.error);
    else setAddress(res.address ?? null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      let documentPath: string | undefined;
      if (file) {
        const prep = await prepareConfirmationUpload(tripId, elementId, file.type, file.size);
        if (prep.error || !prep.path || !prep.token) {
          setError(prep.error ?? "Couldn't attach that file.");
          return;
        }
        const { error: upErr } = await createClient()
          .storage.from(CONFIRMATION_BUCKET)
          .uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type });
        if (upErr) {
          setError("Upload failed. Check the file and try again.");
          return;
        }
        documentPath = prep.path;
      }
      const field_provenance: Record<string, "extracted" | "entered"> = {};
      for (const k of [...TEXT_FIELDS.map((t) => t.key), ...DATE_FIELDS.map((d) => d.key), "lead_booker_id", "amount_charged"]) {
        const val = (f as unknown as Record<string, string>)[k];
        if (val) field_provenance[k] = provenance(k) === "extracted" ? "extracted" : "entered";
      }
      const input: BookingRecordInput = {
        vendor: f.vendor,
        confirmation_ref: f.confirmation_ref,
        starts_at: f.starts_at,
        ends_at: f.ends_at,
        address: f.address,
        checkin_instructions: f.checkin_instructions,
        cancellation_deadline: f.cancellation_deadline,
        cancellation_policy: f.cancellation_policy,
        notes: f.notes,
        lead_booker_id: f.lead_booker_id,
        currency: f.currency,
        field_provenance,
        source: documentPath ? (f.source === "email" ? "email" : "upload") : f.source === "api" ? "manual" : f.source,
        fulfillment_mode: amountFromCard !== null ? "issuing_manual" : "affiliate_redirect",
        seller_of_record: "supplier",
        ...(documentPath ? { document_path: documentPath } : {}),
        ...(amountFromCard === null && mode !== "deferred" ? { amount_charged: f.amount_charged } : {}),
      };
      if (mode === "purchase" || mode === "edit") {
        const res = await saveBookingRecord(tripId, elementId, input, { confirm: true, markBooked: mode === "purchase" });
        if (res.error) return setError(res.error);
      } else {
        const res = await saveBookingRecord(tripId, elementId, input, { confirm: true, markBooked: false });
        if (res.error) return setError(res.error);
        const d = await recordDeferredBooking(tripId, elementId, {
          paymentTiming: deferred.timing,
          freeCancelUntil: f.cancellation_deadline,
          chargeWindowStart: deferred.chargeStart,
          chargeWindowEnd: deferred.chargeEnd,
        });
        if (d.error) return setError(d.error);
      }
      router.refresh();
    });
  }

  const input = `h-9 ${fieldClass}`;

  return (
    <div className="flex flex-col gap-3">
      {f.pendingEmail && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          We read the confirmation you forwarded (&ldquo;{f.pendingEmail.subject}&rdquo;). Fields marked{" "}
          <span className="font-semibold">from email</span> came from it — check each one before confirming.
        </p>
      )}

      <div className="flex flex-col gap-1.5 rounded-lg border border-brand-line p-3 text-xs">
        <span className="font-medium text-black dark:text-zinc-50">Fastest: forward the confirmation email</span>
        <span className="text-brand-muted">
          Forward the vendor&apos;s email from your account address and we&apos;ll fill this in for you to check.
        </span>
        {address === undefined ? (
          <button type="button" onClick={showAddress} className={`w-fit px-2.5 py-1 text-xs ${btnSecondary}`}>
            Show forwarding address
          </button>
        ) : address === null ? (
          <span className="text-brand-muted">Email forwarding isn&apos;t set up in this environment yet — upload or enter it below.</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-black/[.04] px-1.5 py-0.5 dark:bg-white/[.06]">{address}</code>
            <button
              type="button"
              className={`px-2 py-0.5 text-[11px] ${btnSecondary}`}
              onClick={() => {
                navigator.clipboard.writeText(address).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {TEXT_FIELDS.map((t) => (
          <label key={t.key} className={`flex flex-col gap-1 ${t.long ? "sm:col-span-2" : ""}`}>
            <span className={labelClass}>
              {t.label}
              <Badge k={t.key} />
            </span>
            {t.long ? (
              <textarea
                className={`${fieldClass} min-h-14 py-2`}
                value={f[t.key]}
                placeholder={t.placeholder}
                onChange={(e) => set(t.key, e.target.value)}
              />
            ) : (
              <input className={input} value={f[t.key]} placeholder={t.placeholder} onChange={(e) => set(t.key, e.target.value)} />
            )}
          </label>
        ))}
        {DATE_FIELDS.map((d) => (
          <label key={d.key} className="flex flex-col gap-1">
            <span className={labelClass}>
              {d.label}
              {d.key === "cancellation_deadline" && mode === "deferred" ? " *" : ""}
              <Badge k={d.key} />
            </span>
            <input type="datetime-local" className={input} value={f[d.key]} onChange={(e) => set(d.key, e.target.value)} />
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Lead booker / lead guest</span>
          <select className={input} value={f.lead_booker_id} onChange={(e) => set("lead_booker_id", e.target.value)}>
            <option value="">—</option>
            {roster.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.displayName}
              </option>
            ))}
          </select>
        </label>
        {mode !== "deferred" &&
          (amountFromCard !== null ? (
            <span className="flex flex-col gap-1 text-xs">
              <span className={labelClass}>Amount charged</span>
              <span className="font-medium">From the Catoco card</span>
            </span>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Amount actually paid ({f.currency || "trip currency"})</span>
              <input
                type="number"
                min={0}
                step="any"
                className={input}
                value={f.amount_charged}
                onChange={(e) => set("amount_charged", e.target.value)}
              />
            </label>
          ))}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={labelClass}>
            Confirmation document (PDF or image, 10 MB max){f.documentName ? ` — attached: ${f.documentName}` : ""}
          </span>
          <input
            type="file"
            accept={CONFIRMATION_MIME_TYPES.join(",")}
            className="text-xs file:mr-2 file:rounded-md file:border file:border-brand-line file:bg-transparent file:px-2 file:py-1 file:text-xs"
            onChange={(e) => {
              const fl = e.target.files?.[0] ?? null;
              setError(null);
              if (fl && (!CONFIRMATION_MIME_TYPES.includes(fl.type) || fl.size > CONFIRMATION_MAX_BYTES)) {
                setError("Attach a PNG, JPEG, WebP or PDF under 10 MB.");
                e.target.value = "";
                return setFile(null);
              }
              setFile(fl);
            }}
          />
        </label>
      </div>

      {mode === "deferred" && (
        <div className="grid gap-2 rounded-lg border border-brand-line p-3 sm:grid-cols-2">
          <span className="text-xs text-brand-muted sm:col-span-2">
            Pay later only works when the booking can be cancelled for free until after we collect everyone&apos;s share. We
            collect 7 days before the earlier of the free-cancellation deadline and the first date the supplier can charge.
          </span>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>How it&apos;s paid</span>
            <select
              className={input}
              value={deferred.timing}
              onChange={(e) => setDeferred((d) => ({ ...d, timing: e.target.value as "pay_later" | "pay_at_property" }))}
            >
              <option value="pay_at_property">Pay at the property</option>
              <option value="pay_later">Pay later (charged before the stay)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Earliest date they can charge *</span>
            <input type="datetime-local" className={input} value={deferred.chargeStart} onChange={(e) => setDeferred((d) => ({ ...d, chargeStart: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Latest date they can charge</span>
            <input type="datetime-local" className={input} value={deferred.chargeEnd} onChange={(e) => setDeferred((d) => ({ ...d, chargeEnd: e.target.value }))} />
          </label>
        </div>
      )}

      {showIncidentals && (
        <p className="text-[11px] text-brand-muted">
          The Catoco card covers the room and taxes only. Each guest puts their own card down at check-in for incidentals and
          deposits{f.lead_booker_id ? ` — the lead guest is ${roster.find((r) => r.userId === f.lead_booker_id)?.displayName ?? "set above"}` : ""}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={submit} className={`h-9 px-3 text-xs ${btnPrimary}`}>
          {pending ? "Saving…" : mode === "purchase" ? "Confirm & mark booked" : mode === "edit" ? "Save changes" : "Confirm pay-later booking"}
        </button>
        {mode === "purchase" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await reportElementUnavailable(tripId, elementId);
                if (res.error) setError(res.error);
                else router.refresh();
              })
            }
            className="text-xs text-red-600 underline hover:text-red-700 disabled:opacity-40 dark:text-red-400"
          >
            Report unavailable
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
