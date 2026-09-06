"use client";

import { useEffect, useRef, useState } from "react";
import { fieldClass } from "@/lib/ui";
import type { GeocodeResult } from "@/app/api/geocode/route";

const field = `h-10 ${fieldClass}`;

export type GeoPlaceValue = {
  name: string;
  lat?: number;
  lng?: number;
  place_id?: string;
};

/**
 * Mapbox-backed place/POI autocomplete (§3 Destination, §7 Experiences, §8
 * Dining) — shared so all three get the same picker instead of three
 * separate implementations. /api/geocode has no live vendor call wired yet
 * (see that route's own comment), so this always degrades to plain typed
 * text today: results stay empty, the user just types a name and lat/lng/
 * place_id stay unset. Once geocoding is live, selecting a dropdown result
 * is what actually populates those structured fields — this component
 * doesn't need to change for that, only the API route does.
 */
export function PlacePicker({
  value,
  onChange,
  placeholder,
}: {
  value: GeoPlaceValue;
  onChange: (next: GeoPlaceValue) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value.name ?? "");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value.name ?? "");
  }, [value.name]);

  function handleInput(next: string) {
    setQuery(next);
    // Typing freely (no selection made yet) — clears any previously
    // resolved coordinates so a stale lat/lng doesn't silently stick to a
    // now-different name.
    onChange({ name: next });
    setOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!next.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(next)}`);
        const data = (await res.json()) as { results: GeocodeResult[] };
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  function select(result: GeocodeResult) {
    setQuery(result.name);
    setResults([]);
    setOpen(false);
    onChange({ name: result.name, lat: result.lat, lng: result.lng, place_id: result.placeId });
  }

  return (
    <div className="relative">
      <input
        className={field}
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-brand-line bg-background text-sm shadow-sm">
          {results.map((r) => (
            <li key={r.placeId}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-brand-teal-wash"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(r)}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
