"use client";

import { useRef, useState } from "react";
import { fieldClass } from "@/lib/ui";
import type { AirportSuggestion } from "@/lib/vendor-search/airports";

const field = `h-10 ${fieldClass}`;

/**
 * From/To box for flight search: type a city, town or airport and pick a
 * city code ("all airports") or one of the nearest airports. Picking hands
 * the parent the IATA code; typing without picking hands it the raw text,
 * which the server resolves the same way (top suggestion).
 */
export function AirportPicker({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (codeOrText: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [results, setResults] = useState<AirportSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  function handleInput(next: string) {
    setText(next);
    onChange(next);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (next.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const res = await fetch(`/api/airports?q=${encodeURIComponent(next)}`);
        const data = (await res.json()) as { results: AirportSuggestion[] };
        if (seq === seqRef.current) setResults(data.results ?? []);
      } catch {
        if (seq === seqRef.current) setResults([]);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 300);
  }

  function select(s: AirportSuggestion) {
    setText(`${s.name} (${s.code})`);
    setResults([]);
    setOpen(false);
    onChange(s.code);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        className={field}
        placeholder={placeholder}
        value={text}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (loading || results.length > 0) && (
        <ul className="absolute z-10 mt-1 w-full min-w-[16rem] rounded-lg border border-brand-line bg-background text-sm shadow-sm">
          {loading && results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-brand-muted">Finding airports…</li>
          ) : (
            results.map((s) => (
              <li key={s.code}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-brand-teal-wash"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(s)}
                >
                  <span className="mt-0.5 w-9 shrink-0 font-mono text-xs font-semibold text-brand-teal-deep">{s.code}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{s.name}</span>
                    {s.detail && <span className="block truncate text-xs text-brand-muted">{s.detail}</span>}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
