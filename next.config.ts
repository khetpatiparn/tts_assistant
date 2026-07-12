import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Product photos are uploaded through a Server Action, and the default cap
      // is 1MB for the whole request — a single phone photo blows past it. This
      // covers a batch of several files at the 10MB per-file cap enforced in
      // uploadProductImages(), plus multipart overhead.
      bodySizeLimit: "32mb",
    },
  },
};

export default nextConfig;
