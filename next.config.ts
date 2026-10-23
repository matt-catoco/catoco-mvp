import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The service worker must never be served stale, and /offline is the
  // self-contained offline page (public/offline.html).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: "/offline", destination: "/offline.html" }];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "gxdpphgqdmdjwvnhvgsa.supabase.co",
        pathname: "/storage/v1/object/public/trip-icons/**",
      },
    ],
  },
};

export default nextConfig;
