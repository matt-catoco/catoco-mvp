"use client";

import { CURRENCIES, type ElementType } from "@/lib/trip-elements";

const field =
  "h-10 w-full rounded-lg border border-black/[.12] bg-transparent px-3 text-sm outline-none focus:border-black/[.45] dark:border-white/[.16] dark:focus:border-white/[.45]";
const label = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

export function ElementValueFields({
  type,
  value,
  onChange,
}: {
  type: ElementType;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const str = (key: string) => String(value[key] ?? "");

  switch (type) {
    case "dates":
      return (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Start</span>
            <input
              type="date"
              className={field}
              value={str("start")}
              onChange={(e) => set("start", e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>End</span>
            <input
              type="date"
              className={field}
              value={str("end")}
              min={str("start") || undefined}
              onChange={(e) => set("end", e.target.value)}
            />
          </label>
        </div>
      );

    case "destination":
      return (
        <input
          className={field}
          placeholder="e.g. Lisbon, Portugal"
          value={str("name")}
          onChange={(e) => set("name", e.target.value)}
        />
      );

    case "budget":
      return (
        <div className="flex gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>Currency</span>
            <select
              className={`${field} w-24`}
              value={str("currency") || "USD"}
              onChange={(e) => set("currency", e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Amount per person</span>
            <input
              type="number"
              min={1}
              step="any"
              className={field}
              placeholder="1200"
              value={str("amount")}
              onChange={(e) => set("amount", e.target.value)}
            />
          </label>
        </div>
      );

    case "participants":
      return (
        <input
          type="number"
          min={1}
          step={1}
          className={field}
          placeholder="Number of people"
          value={str("count")}
          onChange={(e) => set("count", e.target.value)}
        />
      );

    case "travel":
      return (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder="Mode — e.g. flights, train, road trip"
            value={str("mode")}
            onChange={(e) => set("mode", e.target.value)}
          />
          <input
            className={field}
            placeholder="Note (optional)"
            value={str("note")}
            onChange={(e) => set("note", e.target.value)}
          />
          <CostField value={str("cost")} onChange={(v) => set("cost", v)} />
        </div>
      );

    // accommodation | experience | dining
    default:
      return (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            placeholder="Name"
            value={str("name")}
            onChange={(e) => set("name", e.target.value)}
          />
          <input
            type="url"
            className={field}
            placeholder="Link (optional)"
            value={str("link")}
            onChange={(e) => set("link", e.target.value)}
          />
          <CostField value={str("cost")} onChange={(v) => set("cost", v)} />
        </div>
      );
  }
}

function CostField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={label}>Estimated cost (optional)</span>
      <input
        type="number"
        min={0}
        step="any"
        className={`${field} max-w-[160px]`}
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
