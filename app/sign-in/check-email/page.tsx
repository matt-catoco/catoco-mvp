export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Check your email
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          We sent a magic link{email ? " to " : ""}
          {email && (
            <span className="font-medium text-black dark:text-zinc-50">
              {email}
            </span>
          )}
          . Open it on this device to finish signing in.
        </p>
        <p className="mt-6 text-xs text-zinc-500">
          Wrong address?{" "}
          <a href="/sign-in" className="underline">
            Try again
          </a>
        </p>
      </div>
    </div>
  );
}
