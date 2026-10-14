/**
 * Loading state for My trips and everything under a trip: pulsing versions
 * of the header, a card and the near-square element tiles ("Getting In"
 * restyle, 2026-10-14). Decorative only — screen readers get one status line.
 */
export default function Loading() {
  const block = "rounded-2xl bg-brand-line/60 motion-safe:animate-pulse";
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-12 sm:px-6 sm:py-16">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div className="flex w-full max-w-2xl flex-col gap-6" aria-hidden>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className={`h-7 w-48 ${block}`} />
            <div className={`h-4 w-32 ${block}`} />
          </div>
          <div className={`h-9 w-24 ${block}`} />
        </div>
        <div className={`h-20 w-full ${block}`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`aspect-[11/10] ${block}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
