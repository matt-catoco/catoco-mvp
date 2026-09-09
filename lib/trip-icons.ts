// Trip icon = one of three representations in the same `icon` text column:
//   - `preset:<id>` — emoji presets, retired 2026-09-xx; any trip still
//     carrying one from before that change just resolves to no icon (the
//     "+" placeholder), rather than erroring.
//   - a bare path — a user-uploaded image, resolved against the public
//     `trip-icons` Supabase Storage bucket.
//   - a full `https://` URL — an Unsplash-sourced photo (§3 of the "Add an
//     image" prompt), stored and served exactly as Unsplash returned it
//     (`photo.urls.regular`) per their hotlinking requirement — never
//     downloaded/re-uploaded into the storage bucket.
// `trips.icon_attribution` (photographer_name/photographer_profile_url)
// travels alongside the `unsplash`-sourced case only — needed because
// Unsplash attribution has to render wherever the icon is shown, not just
// be knowable at selection time.

export type ResolvedIcon = { kind: "image"; url: string; source: "upload" | "unsplash" };

export type IconAttribution = {
  photographerName: string;
  photographerProfileUrl: string;
};

export function resolveIcon(
  icon: string | null | undefined,
): ResolvedIcon | null {
  if (!icon || icon.startsWith("preset:")) return null;
  if (icon.startsWith("https://") || icon.startsWith("http://")) {
    return { kind: "image", url: icon, source: "unsplash" };
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return { kind: "image", url: `${base}/storage/v1/object/public/trip-icons/${icon}`, source: "upload" };
}

export const ICON_BUCKET = "trip-icons";
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_ICON_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

// utm_source per the "Add an image" prompt's §4 — matches the app's
// registered Unsplash username.
export const UNSPLASH_UTM_SOURCE = "hello_catoco";
