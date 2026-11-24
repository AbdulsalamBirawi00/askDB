import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // No local .env (CI sets variables directly).
}

const modelTests = process.env.ASKDB_MODEL_TESTS === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./src/", import.meta.url)),
      // `server-only` throws outside the React Server bundle; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Real-model tests (T3.1, T3.9, T3.11, T3.12) spend free quota: only `pnpm test:model` runs them.
    include: modelTests
      ? ["tests/model/**/*.test.ts"]
      : ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    ...(modelTests ? { testTimeout: 120_000 } : {}),
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/instrumentation.ts"],
      reporter: ["text", "json-summary"],
    },
  },
});
