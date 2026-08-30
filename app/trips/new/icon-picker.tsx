"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_ICON_TYPES,
  ICON_BUCKET,
  MAX_ICON_BYTES,
  PRESET_ICONS,
  PRESET_PREFIX,
  resolveIcon,
} from "@/lib/trip-icons";

export function IconPicker({
  value,
  onChange,
  userId,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  userId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = resolveIcon(value);

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
    onChange(path);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-black/[.1] text-2xl dark:border-white/[.14]">
          {resolved?.kind === "preset" && <span>{resolved.emoji}</span>}
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
          {!resolved && <span className="text-zinc-400">＋</span>}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Optional. Pick one below or upload your own.
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="ml-2 underline hover:text-red-500"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESET_ICONS.map((p) => {
          const active = value === `${PRESET_PREFIX}${p.id}`;
          return (
            <button
              key={p.id}
              type="button"
              title={p.label}
              onClick={() => onChange(`${PRESET_PREFIX}${p.id}`)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border text-lg transition-colors ${
                active
                  ? "border-transparent bg-foreground"
                  : "border-black/[.12] hover:bg-black/[.03] dark:border-white/[.16] dark:hover:bg-white/[.05]"
              }`}
            >
              {p.emoji}
            </button>
          );
        })}
      </div>

      <label className="self-start">
        <span className="cursor-pointer rounded-lg border border-black/[.12] px-3 py-1.5 text-xs font-medium hover:bg-black/[.03] dark:border-white/[.16] dark:hover:bg-white/[.05]">
          {uploading ? "Uploading…" : "Upload image"}
        </span>
        <input
          type="file"
          accept={ACCEPTED_ICON_TYPES.join(",")}
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
