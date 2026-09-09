"use server";

import { searchUnsplashPhotos, trackUnsplashDownload, type UnsplashSearchResult } from "@/lib/unsplash";

export type { UnsplashSearchResult };

/** Search-on-submit only — see lib/unsplash.ts's own note on why. */
export async function searchUnsplash(query: string): Promise<UnsplashSearchResult[]> {
  return searchUnsplashPhotos(query);
}

/**
 * Called once, at the moment a result is actually picked (IconPicker's
 * onSelect, before onChange fires) — Unsplash's API guidelines require
 * registering the download_location hit right then, not on every search
 * result rendered or on hover. Server action so UNSPLASH_ACCESS_KEY never
 * reaches the client.
 */
export async function trackUnsplashSelection(downloadLocation: string): Promise<void> {
  await trackUnsplashDownload(downloadLocation);
}
