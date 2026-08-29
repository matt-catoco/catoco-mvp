import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  // No database tables yet — this just confirms the Supabase client and its
  // env vars are wired up. We'll start querying real tables next.
  const supabase = await createClient();
  const supabaseReady =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    Boolean(supabase);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-5xl font-semibold tracking-tight text-black dark:text-zinc-50">
          catoco
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          MVP — Next.js + Supabase
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-full border border-black/[.08] px-4 py-2 text-sm dark:border-white/[.145]">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            supabaseReady ? "bg-green-500" : "bg-red-500"
          }`}
          aria-hidden
        />
        <span className="text-zinc-700 dark:text-zinc-300">
          {supabaseReady
            ? "Supabase client initialized"
            : "Supabase env vars missing"}
        </span>
      </div>

      <Link
        href="/sign-in"
        className="h-11 rounded-lg bg-foreground px-5 text-sm font-medium leading-[2.75rem] text-background transition-opacity hover:opacity-90"
      >
        Get started
      </Link>
    </div>
  );
}
