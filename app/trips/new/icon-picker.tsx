"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_ICON_TYPES,
  ICON_BUCKET,
  MAX_ICON_BYTES,
  UNSPLASH_UTM_SOURCE,
  resolveIcon,
  type IconAttribution,
} from "@/lib/trip-icons";
import { searchUnsplash, trackUnsplashSelection, type UnsplashSearchResult } from "./icon-picker-actions";

/**
 * "Add an image" — upload your own, or search Unsplash. Both paths land on
 * the same onChange(icon, attribution) call; the parent (NewTripForm,
 * TripSettingsForm) is what actually persists both `icon` and
 * `icon_attribution` together, since both live on the trip row.
 *
 * Unsplash's own API guidelines (checked directly, not assumed) require
 * three things this component does and the pre-existing silent auto-fetch
 * (lib/unsplash.ts's fetchUnsplashPhoto, unrelated to this UI) still
 * doesn't — flagged there as a separate, already-shipped gap, not this
 * prompt's scope to fix:
 *   - hotlink photo.urls.regular directly, never re-upload into storage
 *   - show photographer + Unsplash attribution with a UTM-tagged profile link
 *   - fire the download_location tracking call the moment a photo is picked
 */
export function IconPicker({
  value,
  attribution = null,
  onChange,
  userId,
}: {
  value: string | null;
  /** The trip's current icon_attribution, so a previously-picked Unsplash
   * photo still shows its credit after a reload, not just right after
   * picking it in the same session. */
  attribution?: IconAttribution | null;
  onChange: (icon: string | null, attribution: IconAttribution | null) => void;
  userId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = resolveIcon(value);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UnsplashSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPTED_ICON_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG, WebP, or SVG image.");
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setError("Image must be under 2 MB.");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(ICON_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    onChange(path, null);
    setSearchOpen(false);
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearchError(null);
    setSearching(true);
    try {
      const res = await searchUnsplash(query);
      setResults(res);
      if (res.length === 0) setSearchError("No results — try a different search.");
    } catch {
      setSearchError("Search failed. Try again in a moment.");
    } finally {
      setSearching(false);
    }
  }

  async function selectResult(r: UnsplashSearchResult) {
    setSelecting(true);
    // Fire the download_location hit before/as the icon is actually saved —
    // Unsplash's guidelines tie it to the moment of selection, not to every
    // result rendered or hovered.
    await trackUnsplashSelection(r.downloadLocation);
    onChange(r.urlRegular, {
      photographerName: r.photographerName,
      photographerProfileUrl: r.photographerProfileUrl,
    });
    setSelecting(false);
    setSearchOpen(false);
    setResults([]);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-brand-line text-2xl">
          {resolved?.kind === "image" && (
            <Image
              src={resolved.url}
              alt="Trip icon"
              width={56}
              height={56}
              className="h-full w-full object-cover"
              unoptimized
            />
          )}
          {!resolved && <span className="text-brand-muted">＋</span>}
        </div>
        <div className="text-xs text-brand-muted">
          Optional. Add an image for this trip.
          {value && (
            <button
              type="button"
              onClick={() => onChange(null, null)}
              className="ml-2 underline hover:text-red-500"
            >
              Remove
            </button>
          )}
          {resolved?.source === "unsplash" && attribution && (
            <p className="mt-1">
              Photo by {attribution.photographerName} on{" "}
              <a
                href={`${attribution.photographerProfileUrl}?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Unsplash
              </a>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="self-start">
          <span className="cursor-pointer rounded-lg border border-brand-line px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground">
            {uploading ? "Uploading…" : "Upload your own"}
          </span>
          <input
            type="file"
            accept={ACCEPTED_ICON_TYPES.join(",")}
            className="hidden"
            disabled={uploading}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          className="rounded-lg border border-brand-line px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground"
        >
          Search Unsplash
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {searchOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-brand-line p-3">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="e.g. beach, mountains, city skyline"
              className="h-9 flex-1 rounded-lg border border-brand-line bg-transparent px-3 text-sm outline-none focus:border-brand-teal-deep"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={searching || !query.trim()}
              className="h-9 shrink-0 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>

          {searchError && <p className="text-xs text-red-500">{searchError}</p>}

          {results.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={selecting}
                  onClick={() => selectResult(r)}
                  className="aspect-square overflow-hidden rounded-lg border border-brand-line transition-opacity hover:opacity-80 disabled:opacity-40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a search grid of arbitrary external thumbnails */}
                  <img src={r.urlSmall} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <p className="text-[11px] text-brand-muted">
            Photos via{" "}
            <a
              href={`https://unsplash.com/?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Unsplash
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
