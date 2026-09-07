"use client";

import { ELEMENT_METADATA_FIELDS, type ElementType } from "@/lib/trip-elements";
import { fieldClass, labelClass, pillActiveTeal, pillInactive } from "@/lib/ui";

const field = `h-10 ${fieldClass}`;

/**
 * Renders whatever element-level metadata fields a type declares
 * (ELEMENT_METADATA_FIELDS in lib/trip-elements.ts) — generic over the
 * field list rather than one hardcoded form per type, so adding a field to
 * a type is a data change there, not a new case here. All fields optional;
 * this is metadata about the element instance itself (e.g. which dining
 * occasion this is), not a candidate value people vote on.
 *
 * `kind: "select"` fields render as pills, not a native <select> — matching
 * the Add Element modal's Type selector. Generic over the field list, so
 * this covers Dining's Meal field today and any future select-type field
 * (Travel's Mode, Accommodations' Subtype) for free once those exist.
 * Clicking the already-selected pill clears it back to unset, standing in
 * for the native <select>'s blank "—" option.
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
            <div className="flex flex-wrap gap-1.5">
              {f.options?.map((o) => {
                const selected = value[f.key] === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange({ ...value, [f.key]: selected ? "" : o.value })}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selected ? pillActiveTeal : pillInactive
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
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
