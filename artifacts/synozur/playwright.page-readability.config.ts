import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "page-readability.spec.ts",
  workers: 1,
  use: {
    ...base.use,
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:80",
    serviceWorkers: "block",
    video: "off",
  },
});
