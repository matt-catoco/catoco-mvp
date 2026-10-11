import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PaymentsSummary, type SummaryRow } from "@/components/trip-home/payments-summary";

/**
 * Trip payments — organizers and co-organizers only. Enforced twice on the
 * server: this page redirects anyone else back to Trip Home, and
 * get_trip_payment_summary() itself refuses non-organizers.
 */
export default async function TripPaymentsPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}/payments`)}`);
  }

  const [{ data: trip }, { data: canManage }] = await Promise.all([
    supabase.from("trips").select("id, name").eq("id", tripId).maybeSingle(),
    supabase.rpc("is_trip_organizer", { p_trip_id: tripId }),
  ]);
  if (!trip || !canManage) redirect(`/trips/${tripId}`);

  const { data: summary, error } = await supabase.rpc("get_trip_payment_summary", { p_trip_id: tripId });

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <Link href={`/trips/${tripId}`} className="text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-zinc-50">
        ← {trip.name}
      </Link>
      <h1 className="mt-4 mb-6 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">Payments</h1>
      {error ? (
        <p className="text-sm text-red-600">Couldn&apos;t load the trip&apos;s payments. Try again in a moment.</p>
      ) : (
        <PaymentsSummary tripId={tripId} rows={(summary ?? []) as SummaryRow[]} />
      )}
    </div>
  );
}
