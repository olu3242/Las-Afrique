import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // See tests/support/server-only-stub.ts: keeps the build-time guard
      // intact while letting server modules be unit-tested.
      "server-only": fileURLToPath(
        new URL("./tests/support/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Hosted suites talk to a real Supabase project and need credentials that
    // only CI holds. They run via `npm run test:hosted`, never by default.
    exclude: ["tests/hosted/**", "node_modules/**"],
    // Database suites each build their own database; running them in one
    // process keeps create/drop ordering predictable.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
