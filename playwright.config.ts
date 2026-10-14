import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    locale: "zh-CN",
  },
  projects: [{ name: "offline" }],
});
