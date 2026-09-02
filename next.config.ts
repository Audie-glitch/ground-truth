import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next blocks /_next dev resources from any origin it does not consider
  // canonical, which silently prevents hydration when the app is opened on a
  // loopback IP or over the VM's network address rather than on localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0", "172.30.0.2"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coin-images.coingecko.com" },
      { protocol: "https", hostname: "assets.coingecko.com" },
    ],
  },
};

export default nextConfig;
