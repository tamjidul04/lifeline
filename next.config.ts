import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off on purpose: every page is per-user live data (sessions, stock, reservations), so static
  // shells gain little, and request-time rendering keeps auth reads simple and predictable.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
