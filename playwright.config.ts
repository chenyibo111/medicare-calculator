import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    locale: "zh-CN",
  },
  webServer: {
    command: "pnpm --filter @medicare/service-web exec next dev -p 3011",
    url: "http://127.0.0.1:3011",
    reuseExistingServer: true,
  },
  projects: [
    { name: "offline", grep: /@offline/ },
    { name: "service", grep: /@service/ },
  ],
});
