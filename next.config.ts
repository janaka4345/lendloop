import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: {
    unoptimized: true,
    dangerouslyAllowSVG: false,
  },
};

export default nextConfig;
