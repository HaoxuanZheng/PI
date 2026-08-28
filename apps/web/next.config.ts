import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@lifegraph/auth", "@lifegraph/config", "@lifegraph/db", "@lifegraph/domain", "@lifegraph/permissions"]
};

export default nextConfig;
