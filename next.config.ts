import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: process.env.NEXT_OUTPUT_STANDALONE === "true" ? "standalone" : undefined,
  typedRoutes: true
};

export default nextConfig;
