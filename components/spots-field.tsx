"use client";

import { fieldClass, labelClass } from "@/lib/ui";

/**
 * Organizer-only "Spots" input: how many people an element can actually
 * take (a ski house that sleeps 8). Empty = the trip's max (or no limit).
 * When more people are in than there are spots, the cost is split per spot
 * and the first to commit get them — enforced server-side.
 */
export function SpotsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>Spots (optional)</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          inputMode="numeric"
          className={`h-10 w-24 ${fieldClass}`}
          placeholder="Trip max"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="text-xs text-brand-muted">
          Limited room? Cost splits per spot; first to commit get them.
        </span>
      </span>
    </label>
  );
}

/** "" → null (use the trip max); otherwise a whole number ≥ 1, or undefined if invalid. */
export function parseSpots(v: string): number | null | undefined {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}
