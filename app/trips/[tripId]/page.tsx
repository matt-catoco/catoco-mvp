import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function TripLandingPage({
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
    redirect(
      `/sign-in?trip_id=${tripId}&next=${encodeURIComponent(`/trips/${tripId}`)}`,
    );
  }

  // Don't query `public.trips` — it has RLS enabled with no policies yet, so
  // any client read returns nothing until the trip-creation ticket lands.
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          You&apos;re in
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Trip <code className="font-mono text-[0.9em]">{tripId}</code>
        </p>
        <p className="mt-1 text-xs text-zinc-500">Trip details coming soon.</p>
      </div>
    </div>
  );
}
