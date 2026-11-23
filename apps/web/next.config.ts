import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";

// One .env at the repo root serves every package. Vercel and CI set variables directly.
// loadEnvFile never overrides variables that are already set.
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@askdb/db", "@askdb/core"],
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
