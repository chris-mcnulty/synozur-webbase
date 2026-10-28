import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Completion validation also runs the project's typechecks and API suites.
// Keep this focused browser suite from competing with them for four renderers.
export default defineConfig({
  ...base,
  testMatch: "booking-share-image.spec.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    ...base.use,
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:80",
    video: "off",
  },
});
