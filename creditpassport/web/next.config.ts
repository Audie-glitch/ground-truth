import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repository root holds another package.json; pin the workspace root to this app.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
