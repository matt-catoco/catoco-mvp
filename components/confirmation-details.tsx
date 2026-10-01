/**
 * Read-only "Confirmation details" for a booked element — the text and/or
 * attachment the purchaser logged when marking it booked, visible to every
 * trip participant. The attachment arrives as a short-lived signed URL
 * minted server-side (the bucket is private), so this never sees or stores
 * a permanent link.
 */
export function ConfirmationDetails({
  details,
  attachment,
}: {
  details: string | null;
  attachment: { url: string; isPdf: boolean } | null;
}) {
  if (!details && !attachment) return null;
  return (
    <section className="mt-3 rounded-lg border border-brand-line p-3">
      <span className="text-xs font-medium text-black dark:text-zinc-50">Confirmation details</span>
      {details && <p className="mt-2 whitespace-pre-wrap break-words text-xs">{details}</p>}
      {attachment &&
        (attachment.isPdf ? (
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs font-medium text-brand-teal-deep underline"
          >
            View receipt (PDF) ↗
          </a>
        ) : (
          <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL */}
            <img
              src={attachment.url}
              alt="Booking confirmation"
              className="max-h-48 rounded-md border border-brand-line object-contain"
            />
          </a>
        ))}
    </section>
  );
}
