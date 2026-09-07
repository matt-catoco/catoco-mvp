import "server-only";

/**
 * §10's auto-photo hook, now wired: Destination has no booking_link to
 * scrape an Open Graph image from the way Travel/Accommodation/Experience/
 * Dining do (lib/link-preview.ts) — this is its only photo source. Also
 * used as a fallback for Experience/Dining when their own OG scrape didn't
 * turn up an image (a real listing's own photo still wins when it exists).
 * Best-effort, same pattern as link-preview.ts: never throws, never blocks
 * submission.
 */
const UNSPLASH_BASE = "https://api.unsplash.com";

export async function fetchUnsplashPhoto(query: string): Promise<string | undefined> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey || !query.trim()) return undefined;

  try {
    const url = new URL(`${UNSPLASH_BASE}/search/photos`);
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
    if (!res.ok) return undefined;

    const data = await res.json();
    const photo = data?.results?.[0];
    return photo?.urls?.regular ?? photo?.urls?.small ?? undefined;
  } catch {
    return undefined;
  }
}
