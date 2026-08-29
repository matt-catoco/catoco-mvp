import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function TripsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          My Trips
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          You don&apos;t have any trips yet.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Trip creation is coming in a later update.
        </p>
      </div>
    </div>
  );
}
