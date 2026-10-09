"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UNSPLASH_UTM_SOURCE } from "@/lib/trip-icons";
import type { UnsplashSearchResult } from "@/lib/unsplash";
import { searchElementPhotos, setElementImage, type PhotoPick } from "./photo-actions";

/**
 * Camera-icon "Change photo" sheet on a locked element (B3): pick one of the
 * listing's own photos, search Unsplash (credited + download-tracked, per
 * their API terms), or paste an image link.
 */
export function ChangePhoto({
  tripId,
  elementId,
  candidates,
  defaultQuery,
}: {
  tripId: string;
  elementId: string;
  candidates: string[];
  defaultQuery: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<UnsplashSearchResult[]>([]);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, startSave] = useTransition();

  function save(pick: PhotoPick) {
    setMessage(null);
    startSave(async () => {
      const res = await setElementImage(tripId, elementId, pick);
      if (res.error) {
        setMessage(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setMessage(null);
    const { results: r, status } = await searchElementPhotos(query).catch(() => ({ results: [], status: "error" as const }));
    setSearching(false);
    setResults(r);
    if (status === "rate_limited") setMessage("Unsplash search is at its hourly limit — try again in a bit, or paste an image link.");
    else if (status === "error") setMessage("Search failed. Try again in a moment.");
    else if (r.length === 0) setMessage("No results — try a different search.");
  }

  const tile = "aspect-square overflow-hidden rounded-lg border border-brand-line transition-opacity hover:opacity-80 disabled:opacity-40";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change photo"
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur hover:bg-black/70"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        Change photo
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-b border-brand-line p-3 text-left">
          {candidates.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-brand-muted">From the listing</span>
              <div className="grid grid-cols-4 gap-1.5">
                {candidates.slice(0, 8).map((c) => (
                  <button key={c} type="button" disabled={saving} onClick={() => save({ kind: "url", url: c })} className={tile}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary vendor host */}
                    <img src={c} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-brand-muted">Search Unsplash</span>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-brand-line bg-transparent px-3 text-sm outline-none focus:border-brand-teal-deep"
              />
              <button
                type="button"
                onClick={search}
                disabled={searching || !query.trim()}
                className="h-9 shrink-0 rounded-lg bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:opacity-40"
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
            {results.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      save({
                        kind: "unsplash",
                        url: r.urlRegular,
                        photographerName: r.photographerName,
                        photographerProfileUrl: r.photographerProfileUrl,
                        downloadLocation: r.downloadLocation,
                      })
                    }
                    className={tile}
                    title={`Photo by ${r.photographerName}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- Unsplash hotlink, required by their terms */}
                    <img src={r.urlSmall} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-brand-muted">
              Photos via{" "}
              <a href={`https://unsplash.com/?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`} target="_blank" rel="noopener noreferrer" className="underline">
                Unsplash
              </a>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-brand-muted">Or paste an image link</span>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="h-9 min-w-0 flex-1 rounded-lg border border-brand-line bg-transparent px-3 text-sm outline-none focus:border-brand-teal-deep"
              />
              <button
                type="button"
                disabled={saving || !url.trim()}
                onClick={() => save({ kind: "url", url })}
                className="h-9 shrink-0 rounded-lg border border-brand-line px-3 text-xs font-medium hover:border-foreground disabled:opacity-40"
              >
                Use
              </button>
            </div>
          </div>
          {message && <p className="text-xs text-red-500">{message}</p>}
        </div>
      )}
    </>
  );
}
