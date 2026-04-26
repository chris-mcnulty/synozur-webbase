import { defineConfig, devices } from "@playwright/test";

/**
 * #57 + #142 Phase C — End-to-end test config.
 *
 * Runs against any URL exposed via `E2E_BASE_URL` (default
 * http://localhost:5000). To run locally:
 *
 *   PORT=5000 BASE_PATH=/ pnpm --filter @workspace/synozur dev
 *   # ...in another terminal, against the same dev stack:
 *   pnpm --filter @workspace/synozur exec playwright install chromium
 *   pnpm --filter @workspace/synozur test:e2e
 *
 * The harness covers:
 *   - Services pages happy path (#57)
 *   - Accessibility checks via @axe-core/playwright on representative
 *     public routes (#142 Phase C)
 *
 * It deliberately doesn't auto-start the dev server: that would require
 * baking a Postgres connection + seed step into the runner. The
 * GitHub Actions workflow (`.github/workflows/quality.yml`) is set up
 * to run this against a fully provisioned stack on workflow_dispatch.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5000";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The cosmic theme renders dark; avoid Playwright's default white
    // background flashing on screenshot.
    colorScheme: "dark",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
