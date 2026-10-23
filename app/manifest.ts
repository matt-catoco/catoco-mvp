import type { MetadataRoute } from "next";

// Installable web app (app-store prep, prompt A, 2026-10-23). Colours are the
// brand ink and paper tokens (app/page.module.css). Icons come from
// scripts/generate-app-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Catoco",
    short_name: "Catoco",
    description: "Plan it together. Fund it together. Go.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#0D2020",
    background_color: "#FAFAF7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
