import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveIcon } from "@/lib/trip-icons";

type TripRow = {
  id: string;
  name: string;
  icon: string | null;
  status: string;
  created_at: string;
};

function TripIcon({ icon }: { icon: string | null }) {
  const resolved = resolveIcon(icon);
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-brand-line text-lg">
      {resolved?.kind === "preset" && <span>{resolved.emoji}</span>}
      {resolved?.kind === "image" && (
        <Image
          src={resolved.url}
          alt=""
          width={40}
          height={40}
          className="h-full w-full object-cover"
          unoptimized
        />
      )}
      {!resolved && <span className="text-brand-muted">🧳</span>}
    </div>
  );
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
    .select("id, name, icon, status, created_at")
    .order("created_at", { ascending: false })
    .returns<TripRow[]>();

  const hasTrips = (trips?.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          My Trips
        </h1>
        <Link
          href="/trips/new"
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          New trip
        </Link>
      </div>

      {!hasTrips ? (
        <p className="mt-8 rounded-lg border border-black/[.1] p-6 text-center text-sm text-zinc-500 dark:border-white/[.14]">
          You don&apos;t have any trips yet. Create your first one.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {trips!.map((trip) => (
            <li key={trip.id}>
              <Link
                href={`/trips/${trip.id}`}
                className="flex items-center gap-3 rounded-lg border border-brand-line p-3 transition-colors hover:bg-brand-teal-wash"
              >
                <TripIcon icon={trip.icon} />
                <span className="flex-1 truncate text-sm font-medium text-black dark:text-zinc-50">
                  {trip.name}
                </span>
                <span className="rounded-full border border-brand-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-brand-muted">
                  {trip.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
