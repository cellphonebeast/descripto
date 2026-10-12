import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.DESCRIPTO_BUILD_DIR || ".next",
  // Allow larger video uploads through the dev server.
  experimental: {
    serverActions: { bodySizeLimit: "2gb" },
  },
};

export default nextConfig;
