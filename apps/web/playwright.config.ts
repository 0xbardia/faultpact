import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3310", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "pnpm exec next start --hostname 127.0.0.1 --port 3310", url: "http://127.0.0.1:3310", reuseExistingServer: false, timeout: 120000 },
});
