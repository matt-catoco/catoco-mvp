// Trip icon = either a bundled preset (stored as `preset:<id>`, rendered as an
// emoji) or a user upload (stored as the object path in the public `trip-icons`
// Supabase Storage bucket).

export const PRESET_ICONS = [
  { id: "beach", emoji: "🏖️", label: "Beach" },
  { id: "mountains", emoji: "⛰️", label: "Mountains" },
  { id: "city", emoji: "🏙️", label: "City" },
  { id: "roadtrip", emoji: "🚐", label: "Road trip" },
  { id: "tropical", emoji: "🌴", label: "Tropical" },
  { id: "ski", emoji: "🎿", label: "Ski" },
  { id: "hiking", emoji: "🥾", label: "Hiking" },
  { id: "sailing", emoji: "⛵", label: "Sailing" },
  { id: "camping", emoji: "🏕️", label: "Camping" },
  { id: "flight", emoji: "✈️", label: "Flight" },
  { id: "island", emoji: "🏝️", label: "Island" },
  { id: "explore", emoji: "🧭", label: "Explore" },
] as const;

export type PresetIconId = (typeof PRESET_ICONS)[number]["id"];

export const PRESET_PREFIX = "preset:";

export function presetEmoji(id: string): string | null {
  return PRESET_ICONS.find((p) => p.id === id)?.emoji ?? null;
}

export type ResolvedIcon =
  | { kind: "preset"; emoji: string }
  | { kind: "image"; url: string };

export function resolveIcon(
  icon: string | null | undefined,
): ResolvedIcon | null {
  if (!icon) return null;
  if (icon.startsWith(PRESET_PREFIX)) {
    const emoji = presetEmoji(icon.slice(PRESET_PREFIX.length));
    return emoji ? { kind: "preset", emoji } : null;
  }
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
