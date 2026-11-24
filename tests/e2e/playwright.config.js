// Development-only browser test configuration. Run from tests/e2e: npx playwright test
const { defineConfig, devices } = require("@playwright/test");

const PORT = process.env.E2E_PORT || "8799";
module.exports = defineConfig({
  testDir: "./specs",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results/results.json" }]],
  outputDir: "results/artifacts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `python3 serve_e2e.py`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { E2E_PORT: PORT, E2E_DEV_KEY: process.env.E2E_DEV_KEY || "e2e-developer-key" },
  },
});
