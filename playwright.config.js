import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 45000,
  reporter: "list",
  outputDir: "artifacts/test-results",
  use: {
    baseURL: "http://127.0.0.1:34115",
    viewport: { width: 1120, height: 780 },
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
  },
  webServer: {
    command: "go run ./cmd/preview",
    url: "http://127.0.0.1:34115",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
