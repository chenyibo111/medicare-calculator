import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "policy-review-console.spec.ts",
  timeout: 45_000,
  use: { ...devices["Desktop Chrome"], locale: "zh-CN", baseURL: process.env.COMPOSE_SERVICE_URL ?? "http://127.0.0.1:3010" },
  projects: [{ name: "compose-admin" }],
});
