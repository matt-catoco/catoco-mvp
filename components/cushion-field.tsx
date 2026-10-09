"use client";

import { fieldClass, labelClass } from "@/lib/ui";

export type CushionChoice = { kind: "" | "percent" | "amount"; value: string };

/**
 * Organizer-only per-element price cushion override. "" kind = the trip's
 * default (Trip settings). Enforced server-side in set_element_cushion().
 */
export function CushionField({ value, onChange }: { value: CushionChoice; onChange: (v: CushionChoice) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>Price cushion (optional)</span>
      <span className="flex items-center gap-2">
        <select
          className={`h-10 w-auto ${fieldClass}`}
          value={value.kind}
          onChange={(e) => onChange({ ...value, kind: e.target.value as CushionChoice["kind"] })}
          aria-label="Cushion type"
        >
          <option value="">Trip default</option>
          <option value="percent">% of each share</option>
          <option value="amount">per person</option>
        </select>
        {value.kind && (
          <input
            type="number"
            min={0}
            step="any"
            className={`h-10 w-24 ${fieldClass}`}
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            aria-label="Cushion amount"
          />
        )}
      </span>
    </label>
  );
}

/** → { kind: null } for the trip default; undefined if invalid. */
export function parseCushion(c: CushionChoice): { kind: "percent" | "amount" | null; value: number | null } | undefined {
  if (!c.kind) return { kind: null, value: null };
  const n = Number(c.value);
  if (!Number.isFinite(n) || n < 0 || c.value.trim() === "") return undefined;
  return { kind: c.kind, value: n };
}
