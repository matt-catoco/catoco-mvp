import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/trip-elements";
import type { IconAttribution } from "@/lib/trip-icons";
import { getMyTripsContext } from "@/lib/my-trips-context";
import { MyTripsGrid } from "@/components/my-trips/my-trips-grid";
import type { TripCardData } from "@/components/my-trips/trip-card";

type TripRow = {
  id: string;
  name: string;
  icon: string | null;
  icon_attribution: Record<string, unknown> | null;
  created_at: string;
};

/** Same "start_date (– end_date) | N nights | null" rule Trip Home's own
 * subheader uses (app/trips/[tripId]/page.tsx) — one consistent format for
 * a resolved DatesValue everywhere it's shown as a line of text. */
function formatDatesLabel(dates: { start_date?: string; end_date?: string; nights?: number } | null): string | null {
  if (!dates) return null;
  if (dates.start_date) {
    return `${formatDate(dates.start_date)}${dates.end_date ? ` – ${formatDate(dates.end_date)}` : ""}`;
  }
  if (dates.nights) return `${dates.nights} nights`;
  return null;
}

/** A trip is Past once its resolved end date (end_date, or start_date when
 * there's no end_date — a "nights only, no start picked yet" trip has
 * neither, so it can never read as Past) is before today. Everything else,
 * including every trip with no locked Dates element at all, is Upcoming. */
function isPastTrip(dates: { start_date?: string; end_date?: string; nights?: number } | null): boolean {
  const effectiveEnd = dates?.end_date ?? dates?.start_date;
  if (!effectiveEnd) return false;
  const today = new Date().toISOString().slice(0, 10);
  return effectiveEnd < today;
}

export default async function TripsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: trips } = await supabase
    .from("trips")
    .select("id, name, icon, icon_attribution, created_at")
    .order("created_at", { ascending: false })
    .returns<TripRow[]>();

  const rows = trips ?? [];
  const context = await getMyTripsContext(
    supabase,
    rows.map((t) => t.id),
  );

  const upcoming: TripCardData[] = [];
  const past: TripCardData[] = [];
  for (const row of rows) {
    const ctx = context.get(row.id);
    const card: TripCardData = {
      id: row.id,
      name: row.name,
      icon: row.icon,
      iconAttribution: row.icon_attribution as IconAttribution | null,
      destinations: ctx?.destinations ?? [],
      datesLabel: formatDatesLabel(ctx?.dates ?? null),
    };
    (isPastTrip(ctx?.dates ?? null) ? past : upcoming).push(card);
  }

  const hasTrips = rows.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          My Trips
        </h1>
        <Link
          href="/trips/new"
          className="rounded-full bg-foreground px-5 py-[11px] text-sm font-bold text-background transition-opacity hover:opacity-90"
        >
          + New trip
        </Link>
      </div>

      {!hasTrips ? (
        <p className="mt-8 rounded-lg border border-black/[.1] p-6 text-center text-sm text-zinc-500 dark:border-white/[.14]">
          You don&apos;t have any trips yet. Create your first one.
        </p>
      ) : (
        <MyTripsGrid upcoming={upcoming} past={past} />
      )}
    </div>
  );
}
