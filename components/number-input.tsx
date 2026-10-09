"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

/**
 * A number field you can actually clear and retype. A plain
 * `value={n} onChange={(e) => set(Number(e.target.value))}` turns an
 * emptied field into 0 straight away, so typing 25 gives "025". This keeps
 * what's typed as text, reports a number only when it's a real one, and on
 * blur puts back the last valid value if the field was left empty/invalid.
 */
export function NumberInput({
  value,
  onValueChange,
  integer = false,
  ...rest
}: {
  value: number;
  onValueChange: (n: number) => void;
  /** Only whole numbers count as valid. */
  integer?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  // Follow outside changes (e.g. a reset) unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const parse = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return null;
    return n;
  };

  return (
    <input
      {...rest}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n !== null) onValueChange(n);
      }}
      onBlur={(e) => {
        focused.current = false;
        if (parse(draft) === null) setDraft(String(value));
        rest.onBlur?.(e);
      }}
    />
  );
}
