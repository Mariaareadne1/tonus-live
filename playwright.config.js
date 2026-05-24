// playwright.config.js
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src/tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
  },
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
