import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Output configuration for Cloudflare deployment
  output: "standalone",
  
  // Ensure compatibility with Cloudflare Workers
  experimental: {
    // Future experimental features can be added here
  },
};

export default nextConfig;
