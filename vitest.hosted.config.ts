import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Hosted suites. These run against a real Supabase project, so they are opt-in:
 * `npm run test:hosted`, with credentials supplied by the environment.
 *
 * They are the only evidence that can certify the hosted engine — the local
 * Postgres suites prove the migrations and policies are correct, not that they
 * were actually applied to the project the app will talk to.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/hosted/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
