import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
