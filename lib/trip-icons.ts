// Trip icon = a user-uploaded image, stored as the object path in the public
// `trip-icons` Supabase Storage bucket. Emoji presets (stored as
// `preset:<id>`) were removed 2026-09-xx per explicit product decision --
// upload-only now. Any trip still carrying an old `preset:<id>` value from
// before this change just resolves to no icon (the "+" placeholder), rather
// than erroring.

export type ResolvedIcon = { kind: "image"; url: string };

export function resolveIcon(
  icon: string | null | undefined,
): ResolvedIcon | null {
  if (!icon || icon.startsWith("preset:")) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return { kind: "image", url: `${base}/storage/v1/object/public/trip-icons/${icon}` };
}

export const ICON_BUCKET = "trip-icons";
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_ICON_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];
