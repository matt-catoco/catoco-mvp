"use client";

import { ELEMENT_METADATA_FIELDS, type ElementType } from "@/lib/trip-elements";

const field =
  "h-10 w-full rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";
const labelClass = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

/**
 * Renders whatever element-level metadata fields a type declares
 * (ELEMENT_METADATA_FIELDS in lib/trip-elements.ts) — generic over the
 * field list rather than one hardcoded form per type, so adding a field to
 * a type is a data change there, not a new case here. All fields optional;
 * this is metadata about the element instance itself (e.g. which dining
 * occasion this is), not a candidate value people vote on.
 */
export function ElementMetadataFields({
  type,
  value,
  onChange,
}: {
  type: ElementType;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const fields = ELEMENT_METADATA_FIELDS[type];
  if (fields.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className={labelClass}>{f.label} (optional)</span>
          {f.kind === "select" ? (
            <select
              className={field}
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            >
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.kind === "date" ? "date" : "text"}
              className={field}
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
          )}
        </label>
      ))}
    </div>
  );
}
