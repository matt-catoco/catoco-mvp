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

// ---- "Add an image": user-facing Unsplash search ---------------------------
// A genuine multi-result search, distinct from fetchUnsplashPhoto()'s single-
// result silent fallback above (left untouched — different call sites, same
// API). Search-on-submit only (a Search button, not live/debounced-as-you-
// type) — Unsplash's free "Demo" tier caps at 50 requests/hour app-wide;
// see the build prompt's own §5 on confirming Production-tier approval
// before this ships broadly.
export type UnsplashSearchResult = {
  id: string;
  urlSmall: string;
  urlRegular: string;
  photographerName: string;
  photographerProfileUrl: string;
  // photo.links.download_location — NOT a photo URL. Unsplash's API
  // guidelines require calling this exact endpoint the moment a photo is
  // actually selected/used (separate from just having appeared in search
  // results), to register the "download" with them. See
  // trackUnsplashDownload() below.
  downloadLocation: string;
};

type UnsplashApiPhoto = {
  id?: string;
  urls?: { small?: string; regular?: string };
  user?: { name?: string; links?: { html?: string } };
  links?: { download_location?: string };
};

// Deliberately staying on Unsplash's free "Demo" tier (50 requests/hour,
// app-wide) rather than applying for Production approval — the founder's
// call, 2026-09-xx: keep this at zero cost for as long as possible, which
// means the app has to actually behave well when that cap gets hit, not
// just work in the happy path. `rate_limited` is Unsplash's real, expected
// failure mode here (they return 403 with an explicit rate-limit error once
// the hour's 50 requests are spent) — worth telling the user apart from
// "your search term matched nothing," which reads as a dead end (retrying
// just burns another request) rather than "try again in a few minutes, or
// upload instead."
export type UnsplashSearchOutcome = {
  results: UnsplashSearchResult[];
  status: "ok" | "rate_limited" | "error";
};

export async function searchUnsplashPhotos(
  query: string,
  page = 1,
): Promise<UnsplashSearchOutcome> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey || !query.trim()) return { results: [], status: "ok" };

  try {
    const url = new URL(`${UNSPLASH_BASE}/search/photos`);
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "12");
    url.searchParams.set("page", String(page));
    url.searchParams.set("orientation", "landscape");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
    if (!res.ok) {
      // Unsplash's rate-limit response is a 403 — distinct from a 401 (bad
      // key) or a 5xx (their own outage), both of which are real errors
      // rather than "come back later."
      return { results: [], status: res.status === 403 ? "rate_limited" : "error" };
    }

    const data = await res.json();
    const results: UnsplashApiPhoto[] = data?.results ?? [];
    return {
      results: results
        .map((p) => ({
          id: p.id ?? "",
          urlSmall: p.urls?.small ?? "",
          urlRegular: p.urls?.regular ?? "",
          photographerName: p.user?.name ?? "Unknown photographer",
          photographerProfileUrl: p.user?.links?.html ?? "",
          downloadLocation: p.links?.download_location ?? "",
        }))
        .filter((r) => r.id && r.urlSmall && r.urlRegular),
      status: "ok",
    };
  } catch {
    return { results: [], status: "error" };
  }
}

/**
 * Fire-and-forget, per Unsplash's API guidelines: the moment a photo is
 * actually selected (not on every search result rendered, not on hover),
 * hit the download_location endpoint they returned for it. Server-side so
 * the access key never reaches the client. Never throws — a failed
 * tracking call shouldn't block the icon from actually being saved.
 */
export async function trackUnsplashDownload(downloadLocation: string): Promise<void> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey || !downloadLocation) return;
  try {
    await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
  } catch {
    // best-effort, see doc comment above
  }
}
