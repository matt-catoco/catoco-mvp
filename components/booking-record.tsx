import { formatCurrency } from "@/lib/trip-elements";

export type BookingRecordView = {
  vendor: string | null;
  confirmation_ref: string | null;
  starts_at: string | null;
  ends_at: string | null;
  address: string | null;
  checkin_instructions: string | null;
  cancellation_deadline: string | null;
  cancellation_policy: string | null;
  notes: string | null;
  amount_charged: number | null;
  currency: string | null;
  source: string;
  field_provenance: Record<string, "extracted" | "entered">;
  payment_timing: "pay_now" | "pay_later" | "pay_at_property";
  funding_due_at: string | null;
  paid_at_property_note: string | null;
  confirmed_at: string | null;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : null;

/**
 * The booking record — the lasting reference for a booked element, shown to
 * everyone in the element plus organizers/purchaser. The lead booker's name
 * arrives already masked per "View all participants". Each field says
 * whether it was read from a document (and confirmed) or typed in.
 */
export function BookingRecord({
  record,
  document,
  leadName,
  showIncidentals,
}: {
  record: BookingRecordView;
  document: { url: string; isPdf: boolean } | null;
  leadName: string | null;
  showIncidentals: boolean;
}) {
  const rows: { key: string; label: string; value: string | null }[] = [
    { key: "vendor", label: "Vendor", value: record.vendor },
    { key: "confirmation_ref", label: "Confirmation", value: record.confirmation_ref },
    { key: "starts_at", label: "Starts", value: fmt(record.starts_at) },
    { key: "ends_at", label: "Ends", value: fmt(record.ends_at) },
    { key: "address", label: "Address / meeting point", value: record.address },
    { key: "checkin_instructions", label: "Check-in / meeting", value: record.checkin_instructions },
    { key: "cancellation_deadline", label: "Free cancellation until", value: fmt(record.cancellation_deadline) },
    { key: "cancellation_policy", label: "Cancellation policy", value: record.cancellation_policy },
    { key: "lead_booker_id", label: "Lead booker", value: leadName },
    {
      key: "amount_charged",
      label: "Amount charged",
      value: record.amount_charged != null ? formatCurrency(Number(record.amount_charged), record.currency ?? "USD") : null,
    },
    { key: "notes", label: "Notes", value: record.notes },
  ];
  const deferred = record.payment_timing !== "pay_now";

  return (
    <section className="mt-3 flex flex-col gap-2 rounded-lg border border-brand-line p-3 text-xs">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium text-black dark:text-zinc-50">Booking record</span>
        {deferred && (
          <span className="rounded-full border border-amber-400 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            {record.payment_timing === "pay_at_property" ? "Pay at property" : "Pay later"}
          </span>
        )}
      </span>
      {deferred && record.funding_due_at && (
        <p className="text-brand-muted">
          Booked now, paid later — everyone&apos;s share is collected on {fmt(record.funding_due_at)}.
        </p>
      )}
      <dl className="flex flex-col gap-1.5">
        {rows
          .filter((r) => r.value)
          .map((r) => (
            <div key={r.key} className="grid grid-cols-[8rem_1fr] gap-x-3">
              <dt className="text-brand-muted">{r.label}</dt>
              <dd className="whitespace-pre-line break-words font-medium">
                {r.value}
                {record.field_provenance[r.key] && (
                  <span className="ml-1.5 text-[10px] font-normal text-brand-muted">
                    ({record.field_provenance[r.key] === "extracted" ? "read from the confirmation" : "entered"})
                  </span>
                )}
              </dd>
            </div>
          ))}
      </dl>
      {document &&
        (document.isPdf ? (
          <a href={document.url} target="_blank" rel="noopener noreferrer" className="w-fit font-medium text-brand-teal-deep underline">
            View confirmation (PDF) ↗
          </a>
        ) : (
          <a href={document.url} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL */}
            <img src={document.url} alt="Booking confirmation" className="max-h-48 rounded-md border border-brand-line object-contain" />
          </a>
        ))}
      {record.paid_at_property_note && (
        <p className="text-brand-muted">Paid at the property, not covered by the card: {record.paid_at_property_note}</p>
      )}
      {showIncidentals && (
        <p className="text-brand-muted">
          The Catoco card covers the room and taxes only. Each guest puts their own card down at check-in for incidentals and
          deposits{leadName ? ` — lead guest: ${leadName}` : ""}.
        </p>
      )}
    </section>
  );
}
