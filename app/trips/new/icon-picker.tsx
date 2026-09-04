"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ACCEPTED_ICON_TYPES, ICON_BUCKET, MAX_ICON_BYTES, resolveIcon } from "@/lib/trip-icons";

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
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-brand-line text-2xl">
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
          {!resolved && <span className="text-brand-muted">＋</span>}
        </div>
        <div className="text-xs text-brand-muted">
          Optional. Upload an image for this trip.
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

      <label className="self-start">
        <span className="cursor-pointer rounded-lg border border-brand-line px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground">
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
