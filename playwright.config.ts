import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end configuration.
 *
 * The suite runs against a production build, not the dev server: middleware
 * behaviour, static prerendering and bundle contents all differ between the two,
 * and the auth gate is exactly the kind of thing that must be verified as it
 * will actually ship.
 *
 * PLAYWRIGHT_CHROMIUM_PATH lets a sandbox with a pre-installed browser point at
 * it instead of downloading one. CI leaves it unset and uses the browser
 * `npx playwright install chromium` provides.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  // The JSON report is what lets CI tell a skipped journey from a passing one.
  // Without it, a spec that skipped itself for want of credentials would leave
  // a green job behind and read as proof.
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["json", { outputFile: "e2e-results.json" }],
      ]
    : "list",

  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "on-first-retry",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
